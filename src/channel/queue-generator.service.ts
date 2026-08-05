import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChannelSubreddit } from './entities/channel-subreddit.entity';
import { ChannelPostProgress } from './entities/channel-post-progress.entity';
import {
  Segment,
  SongSegment,
  TalkSegment,
  AdSegment,
  JingleSegment,
} from './entities/segment.entity';
import { Post } from '../feed/entities/post.entity';
import { RadioService } from '../radio/radio.service';
import { MediaService } from '../media/media.service';
import { clusterPosts } from './utils/topic-clustering.util';
import { ScraperService } from '../feed/scraper.service';
import { ChunkerService } from './chunker.service';
import { Topic } from './interfaces/topic.interface';

@Injectable()
export class QueueGeneratorService {
  constructor(
    @InjectRepository(Segment)
    private readonly segmentRepo: Repository<Segment>,
    @InjectRepository(ChannelSubreddit)
    private readonly channelSubredditRepo: Repository<ChannelSubreddit>,
    @InjectRepository(ChannelPostProgress)
    private readonly progressRepo: Repository<ChannelPostProgress>,
    @InjectRepository(Post)
    private readonly postRepo: Repository<Post>,
    private readonly radioService: RadioService,
    private readonly mediaService: MediaService,
    private readonly scraperService: ScraperService,
    private readonly chunker: ChunkerService,
  ) {}

  async bufferAhead(channelId: string): Promise<void> {
    // No size gate here: callers (ChannelPlaybackService) own the "when" —
    // they only invoke this when the runway is low or empty. Counting total
    // rows would permanently block refills once 5+ rows exist (dead air).
    const lastItem = await this.segmentRepo.findOne({
      where: { channelId },
      order: { playOrder: 'DESC' },
    });
    let nextPlayOrder = lastItem ? lastItem.playOrder + 1 : 1;

    // Sequence Pattern: [1-2 Talk] -> [1-2 Songs] -> [1-2 Ads] -> [1 Jingle]
    const talkCount = this.getRandomCount();
    for (let i = 0; i < talkCount; i++) {
      const next = await this.appendTalk(channelId, nextPlayOrder);
      nextPlayOrder =
        next ?? (await this.appendFiller(channelId, nextPlayOrder));
    }

    const songCount = this.getRandomCount();
    for (let i = 0; i < songCount; i++) {
      nextPlayOrder = await this.appendSong(channelId, nextPlayOrder);
    }

    const adCount = this.getRandomCount();
    for (let i = 0; i < adCount; i++) {
      nextPlayOrder = await this.appendAd(channelId, nextPlayOrder);
    }

    // Always finish cycle with 1 Jingle stinger
    await this.appendJingle(channelId, nextPlayOrder++);
  }

  public getRandomCount(): number {
    return Math.random() < 0.5 ? 1 : 2;
  }

  private async appendTalk(
    channelId: string,
    playOrder: number,
  ): Promise<number | null> {
    const topicSegment = await this.findPendingTopicSegment(channelId);
    if (topicSegment) {
      const talkItem = Object.assign(new TalkSegment(), {
        channelId,
        playOrder,
        status: 'generating',
        topicId: topicSegment.id,
      });
      const savedTalkItem = await this.segmentRepo.save(talkItem);

      // Immediately mark posts as completed to prevent double-queuing
      for (const p of topicSegment.posts) {
        const progress = this.progressRepo.create({
          channelId,
          postId: p.id,
        });
        await this.progressRepo.save(progress);
      }

      // Trigger background voice generation (asynchronous)
      const postIds = topicSegment.posts.map((p) => p.id);
      this.radioService
        .getSegmentVoiceTrack(postIds)
        .then(async (voiceTrack) => {
          savedTalkItem.audioUrl = voiceTrack.filePath;
          savedTalkItem.durationSeconds = voiceTrack.durationSeconds;
          savedTalkItem.status = 'ready';
          await this.segmentRepo.save(savedTalkItem);

          await this.chunker.sliceAndUpload(
            channelId,
            savedTalkItem.id,
            voiceTrack.filePath,
          );
        })
        .catch(async () => {
          savedTalkItem.status = 'failed';
          await this.segmentRepo.save(savedTalkItem);
        });
      return playOrder + 1;
    }
    // No topic available: signal the caller to append a filler instead
    return null;
  }

  /**
   * Short filler (ad) appended when no topic is available. A short bridge
   * means the queue drains to the next topic-check faster.
   */
  private async appendFiller(
    channelId: string,
    playOrder: number,
  ): Promise<number> {
    return this.appendAd(channelId, playOrder);
  }

  private async appendSong(
    channelId: string,
    playOrder: number,
  ): Promise<number> {
    const song = await this.mediaService.getRandomMusic();
    const songItem = Object.assign(new SongSegment(), {
      channelId,
      playOrder,
      audioUrl: song.filePath,
      durationSeconds: song.durationSeconds,
      title: song.title,
      artist: song.artist,
    });
    const savedSong = await this.segmentRepo.save(songItem);
    await this.chunker.sliceAndUpload(channelId, savedSong.id, song.filePath);
    return playOrder + 1;
  }

  private async appendAd(
    channelId: string,
    playOrder: number,
  ): Promise<number> {
    const ad = await this.mediaService.getRandomAd();
    const adItem = Object.assign(new AdSegment(), {
      channelId,
      playOrder,
      audioUrl: ad.filePath,
      durationSeconds: ad.durationSeconds,
    });
    const savedAd = await this.segmentRepo.save(adItem);
    await this.chunker.sliceAndUpload(channelId, savedAd.id, ad.filePath);
    return playOrder + 1;
  }

  private async appendJingle(
    channelId: string,
    playOrder: number,
  ): Promise<number> {
    const jingle = await this.mediaService.getRandomJingle();
    const jingleItem = Object.assign(new JingleSegment(), {
      channelId,
      playOrder,
      audioUrl: jingle.filePath,
      durationSeconds: jingle.durationSeconds,
    });
    const savedJingle = await this.segmentRepo.save(jingleItem);
    await this.chunker.sliceAndUpload(
      channelId,
      savedJingle.id,
      jingle.filePath,
    );
    return playOrder + 1;
  }

  public async findPendingTopicSegment(
    channelId: string,
  ): Promise<Topic | null> {
    const subs = await this.channelSubredditRepo.find({
      where: { channelId },
      relations: { subreddit: true },
    });
    if (subs.length === 0) return null;

    const completedProgress = await this.progressRepo.find({
      where: { channelId },
    });
    const completedPostIds = completedProgress.map((p) => p.postId);

    const subIds = subs.map((s) => s.subredditId);
    const allPosts = await this.postRepo.find({
      where: subIds.map((subredditId) => ({ subredditId })),
    });

    const subsToScrape: string[] = [];
    const ttlMs = 72 * 60 * 60 * 1000; // 72 hours cache TTL

    for (const subRelation of subs) {
      const sub = subRelation.subreddit;
      if (!sub) continue;

      const isStale =
        !sub.lastScrapedAt || Date.now() - sub.lastScrapedAt.getTime() > ttlMs;

      // Exhaustion: check if there are 0 unplayed posts remaining in DB for this sub
      const postsInSub = allPosts.filter((p) => p.subredditId === sub.id);
      const unplayedInSub = postsInSub.filter(
        (p) => !completedPostIds.includes(p.id),
      );
      const isExhausted = unplayedInSub.length === 0;

      if (isStale || isExhausted) {
        subsToScrape.push(sub.name);
      }
    }

    if (subsToScrape.length > 0) {
      // Sequential background chain: each sub's scrape completes before the
      // next starts — proper request spacing matters (no parallel scraping).
      // Never blocks topic generation: the whole chain runs in the background.
      // (Every scrape has a .catch, so the chain never rejects.)
      const runSequentialScrapes = async (): Promise<void> => {
        for (const name of subsToScrape) {
          await this.scraperService.scrapeSubreddit(name).catch(() => {});
        }
      };
      void runSequentialScrapes();
    }

    const unplayedPosts = allPosts.filter(
      (p) => !completedPostIds.includes(p.id),
    );
    if (unplayedPosts.length === 0) return null;

    const segments = clusterPosts(unplayedPosts);
    return segments[0] || null;
  }
}
