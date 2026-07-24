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
    const count = await this.segmentRepo.count({ where: { channelId } });
    if (count >= 5) {
      return; // Already has enough items buffered
    }

    const lastItem = await this.segmentRepo.findOne({
      where: { channelId },
      order: { playOrder: 'DESC' },
    });
    let nextPlayOrder = lastItem ? lastItem.playOrder + 1 : 1;

    // Sequence Pattern: [1-2 Talk] -> [1-2 Songs] -> [1-2 Ads] -> [1 Jingle]
    const talkCount = this.getRandomCount();
    for (let i = 0; i < talkCount; i++) {
      nextPlayOrder = await this.appendTalkOrFallbackSong(
        channelId,
        nextPlayOrder,
      );
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

  private async appendTalkOrFallbackSong(
    channelId: string,
    playOrder: number,
  ): Promise<number> {
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
    } else {
      // Fallback if no topics: insert song instead
      await this.appendSong(channelId, playOrder);
    }
    return playOrder + 1;
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
      for (let i = 0; i < subsToScrape.length; i++) {
        const name = subsToScrape[i];

        // Apply a randomized 5-6s context rotation delay before subsequent scrapes
        if (i > 0) {
          const delayMs = Math.floor(Math.random() * 1000) + 5000;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }

        await this.scraperService.scrapeSubreddit(name);
      }
    }

    // Fetch again after potentially scraping new posts
    const posts = await this.postRepo.find({
      where: subIds.map((subredditId) => ({ subredditId })),
      order: { score: 'DESC', redditCreatedAt: 'DESC' },
    });

    const unplayedPosts = posts.filter((p) => !completedPostIds.includes(p.id));
    if (unplayedPosts.length === 0) return null;

    const segments = clusterPosts(unplayedPosts);
    return segments[0] || null;
  }
}
