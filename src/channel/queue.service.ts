import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Segment,
  SongSegment,
  TalkSegment,
  AdSegment,
  JingleSegment,
} from './entities/segment.entity';
import { ChannelSubreddit } from './entities/channel-subreddit.entity';
import { ChannelPostProgress } from './entities/channel-post-progress.entity';
import { MediaService } from '../media/media.service';
import { clusterPosts } from './utils/topic-clustering.util';
import { Topic } from './interfaces/topic.interface';
import { createServiceLogger } from '../infrastructure/logging/logging.module';
import {
  ContentContract,
  ScriptContract,
  VoiceContract,
} from '../domain/contracts';
import { PostData } from '../domain/types/post.types';
import { ScriptData } from '../domain/types/script.types';
import { TalkData } from '../domain/types/audio.types';
import { randomUUID } from 'crypto';

const SCRAPE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7-day scrape window

@Injectable()
export class QueueService {
  private readonly logger = createServiceLogger(QueueService.name);

  constructor(
    @InjectRepository(Segment)
    private readonly segmentRepo: Repository<Segment>,
    @InjectRepository(ChannelSubreddit)
    private readonly channelSubredditRepo: Repository<ChannelSubreddit>,
    @InjectRepository(ChannelPostProgress)
    private readonly progressRepo: Repository<ChannelPostProgress>,
    private readonly mediaService: MediaService,
    private readonly contentContract: ContentContract,
    private readonly scriptContract: ScriptContract,
    private readonly voiceContract: VoiceContract,
  ) {}

  async bufferAhead(channelId: string): Promise<void> {
    const lastItem = await this.segmentRepo.findOne({
      where: { channelId },
      order: { playOrder: 'DESC' },
    });
    let nextPlayOrder = lastItem ? lastItem.playOrder + 1 : 1;

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

      this.generateTalkVoiceTrack(topicSegment.posts)
        .then(async (voiceTrack: TalkData) => {
          for (const p of topicSegment.posts) {
            await this.markPostCompletedForChannel(channelId, p.id);
          }
          savedTalkItem.audioUrl = voiceTrack.filePath;
          savedTalkItem.durationSeconds = voiceTrack.durationSeconds;
          savedTalkItem.status = 'ready';
          await this.segmentRepo.save(savedTalkItem);
        })
        .catch(async (err) => {
          savedTalkItem.status = 'failed';
          await this.segmentRepo.save(savedTalkItem);
          this.logger.error(
            {
              channelId,
              segmentId: savedTalkItem.id,
              err: err instanceof Error ? err : new Error(String(err)),
            },
            'voice generation failed',
          );
        });
      return playOrder + 1;
    }
    return null;
  }

  private async generateTalkVoiceTrack(posts: PostData[]): Promise<TalkData> {
    const comments = await this.contentContract.getCommentsByPostIds(
      posts.map((p) => p.id),
    );
    const rawScript = await this.scriptContract.generateScript(posts, comments);

    const filePath = `topic-audios/talk-${randomUUID()}.mp3`;
    const scriptObj: ScriptData =
      typeof rawScript === 'string'
        ? {
            postId: posts[0].id,
            turns: [{ speaker: 'Host', text: rawScript }],
          }
        : rawScript;

    const talkRef = await this.voiceContract.synthesizeScript(
      scriptObj,
      filePath,
    );
    return talkRef;
  }

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
    await this.segmentRepo.save(songItem);
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
    await this.segmentRepo.save(adItem);
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
    await this.segmentRepo.save(jingleItem);
    return playOrder + 1;
  }

  public async findPendingTopicSegment(
    channelId: string,
  ): Promise<Topic | null> {
    const subs = await this.channelSubredditRepo.find({
      where: { channelId },
    });
    const subIds = subs.map((s) => s.subredditId);
    if (subIds.length === 0) return null;

    const progress = await this.progressRepo.find({
      where: { channelId },
    });
    const completedPostIds = progress.map((p) => p.postId);

    const subreddits = await this.contentContract.getSubredditsByIds(subIds);
    const allPosts = await this.contentContract.getPostsBySubredditIds(subIds);

    const subsToScrape: string[] = [];
    const ttlMs = SCRAPE_WINDOW_MS;

    for (const sub of subreddits) {
      const isStale =
        !sub.lastScrapedAt || Date.now() - sub.lastScrapedAt.getTime() > ttlMs;

      const postsInSub = allPosts.filter((p) => p.subredditId === sub.id);
      const unplayedInSub = postsInSub.filter(
        (p) => !completedPostIds.includes(p.id),
      );
      const isExhausted = unplayedInSub.length === 0;

      const decision = isStale ? 'stale' : isExhausted ? 'exhausted' : 'fresh';
      this.logger.debug(
        {
          channelId,
          sub: sub.name,
          decision,
          staleAgeMs: sub.lastScrapedAt
            ? Date.now() - sub.lastScrapedAt.getTime()
            : null,
          unplayed: unplayedInSub.length,
        },
        'scrape decision',
      );

      if (isStale || isExhausted) {
        subsToScrape.push(sub.name);
      }
    }

    if (subsToScrape.length > 0) {
      this.logger.info(
        { channelId, subsToScrape },
        'background scrape chain started',
      );
      const runSequentialScrapes = async (): Promise<void> => {
        for (const name of subsToScrape) {
          await this.contentContract.scrapeSubreddit(name).catch(() => {});
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

  private async markPostCompletedForChannel(
    channelId: string,
    postId: string,
  ): Promise<void> {
    const progress = this.progressRepo.create({
      channelId,
      postId,
    });
    await this.progressRepo.save(progress);
  }
}
