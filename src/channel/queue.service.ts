import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository, EntityManager } from '@mikro-orm/postgresql';
import { Channel, SubredditRef, PostRef } from './entities/channel.entity';
import {
  Segment,
  MusicSegment,
  TalkSegment,
  AdSegment,
  JingleSegment,
} from './entities/segment.entity';
import {
  ChannelSchema,
  SegmentSchema,
} from '../infrastructure/database/schemas/channel.schema';
import { clusterPosts } from './utils/topic-clustering.util';
import { TalkCluster } from './interfaces/talk-cluster.interface';
import { createServiceLogger } from '../infrastructure/logging/logging.module';
import {
  ContentContract,
  ScriptContract,
  VoiceContract,
  MediaContract,
} from '../domain/contracts';
import { PostData } from '../domain/types/post.types';
import { ScriptData } from '../domain/types/script.types';
import { TalkData } from '../domain/types/audio.types';
import { SubredditData } from '../domain/types/subreddit.types';
import { randomUUID } from 'crypto';

const SCRAPE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7-day scrape window

@Injectable()
export class QueueService {
  private readonly logger = createServiceLogger(QueueService.name);

  constructor(
    @InjectRepository(ChannelSchema)
    private readonly channelRepo: EntityRepository<Channel>,
    @InjectRepository(SegmentSchema)
    private readonly segmentRepo: EntityRepository<Segment>,
    private readonly em: EntityManager,
    private readonly mediaService: MediaContract,
    private readonly contentContract: ContentContract,
    private readonly scriptContract: ScriptContract,
    private readonly voiceContract: VoiceContract,
  ) {}

  async bufferAhead(channelId: string): Promise<void> {
    const lastItem = await this.segmentRepo.findOne(
      { channel: channelId },
      { orderBy: { playOrder: 'DESC' } },
    );
    let nextPlayOrder = lastItem ? lastItem.playOrder + 1 : 1;

    const talkCount = this.getRandomCount();
    for (let i = 0; i < talkCount; i++) {
      const next = await this.appendTalk(channelId, nextPlayOrder);
      nextPlayOrder =
        next ?? (await this.appendFiller(channelId, nextPlayOrder));
    }

    const musicCount = this.getRandomCount();
    for (let i = 0; i < musicCount; i++) {
      nextPlayOrder = await this.appendMusic(channelId, nextPlayOrder);
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
    const talkCluster = await this.findPendingTopicSegment(channelId);
    if (talkCluster) {
      const talkItem: TalkSegment = Object.assign(new TalkSegment(), {
        channel: this.em.getReference(Channel, channelId),
        channelId,
        playOrder,
        clusterId: talkCluster.id,
      });
      await this.em.persist(talkItem).flush();

      this.generateTalkVoiceTrack(talkCluster.posts)
        .then(async ({ voiceTrack, scriptObj }) => {
          for (const p of talkCluster.posts) {
            await this.markPostCompletedForChannel(channelId, p.id);
          }
          talkItem.audioUrl = voiceTrack.filePath;
          talkItem.durationSeconds = voiceTrack.durationSeconds;
          talkItem.status = 'ready';
          talkItem.script = scriptObj.turns;
          await this.em.flush();
        })
        .catch(async (err) => {
          talkItem.status = 'failed';
          await this.em.flush();
          this.logger.error(
            {
              channelId,
              segmentId: talkItem.id,
              err: err instanceof Error ? err : new Error(String(err)),
            },
            'voice generation failed',
          );
        });
      return playOrder + 1;
    }
    return null;
  }

  private async generateTalkVoiceTrack(
    posts: PostData[],
  ): Promise<{ voiceTrack: TalkData; scriptObj: ScriptData }> {
    const comments = await this.contentContract.getCommentsByPostIds(
      posts.map((p) => p.id),
    );
    const rawScript = await this.scriptContract.generateScript(posts, comments);

    const filePath = `audio/talk-${randomUUID()}.mp3`;
    const scriptObj: ScriptData =
      typeof rawScript === 'string'
        ? {
            postId: posts[0].id,
            turns: [{ speaker: 'Host', text: rawScript }],
          }
        : rawScript;

    const voiceTrack = await this.voiceContract.synthesizeScript(
      scriptObj,
      filePath,
    );
    return { voiceTrack, scriptObj };
  }

  private async appendFiller(
    channelId: string,
    playOrder: number,
  ): Promise<number> {
    return this.appendAd(channelId, playOrder);
  }

  private async appendMusic(
    channelId: string,
    playOrder: number,
  ): Promise<number> {
    const music = await this.mediaService.getRandomMusic();
    const musicItem = Object.assign(new MusicSegment(), {
      channel: this.em.getReference(Channel, channelId),
      channelId,
      playOrder,
      audioUrl: music.filePath,
      durationSeconds: music.durationSeconds,
      title: music.title,
      artist: music.artist,
    });
    await this.em.persist(musicItem).flush();
    return playOrder + 1;
  }

  private async appendAd(
    channelId: string,
    playOrder: number,
  ): Promise<number> {
    const ad = await this.mediaService.getRandomAd();
    const adItem = Object.assign(new AdSegment(), {
      channel: this.em.getReference(Channel, channelId),
      channelId,
      playOrder,
      audioUrl: ad.filePath,
      durationSeconds: ad.durationSeconds,
    });
    await this.em.persist(adItem).flush();
    return playOrder + 1;
  }

  private async appendJingle(
    channelId: string,
    playOrder: number,
  ): Promise<number> {
    const jingle = await this.mediaService.getRandomJingle();
    const jingleItem = Object.assign(new JingleSegment(), {
      channel: this.em.getReference(Channel, channelId),
      channelId,
      playOrder,
      audioUrl: jingle.filePath,
      durationSeconds: jingle.durationSeconds,
    });
    await this.em.persist(jingleItem).flush();
    return playOrder + 1;
  }

  public async findPendingTopicSegment(
    channelId: string,
  ): Promise<TalkCluster | null> {
    const channel = await this.channelRepo.findOne(
      { id: channelId },
      { populate: ['subreddits', 'completedPosts'] },
    );
    if (!channel) return null;
    const subreddits = channel.subreddits.getItems();
    const subIds = subreddits.map((s: SubredditRef) => s.id);
    if (subIds.length === 0) return null;

    const completedPosts = channel.completedPosts.getItems();
    const completedPostIds = completedPosts.map((p: PostRef) => p.id);

    const subredditDetails: SubredditData[] =
      await this.contentContract.getSubredditsByIds(subIds);
    const allPosts = await this.contentContract.getPostsBySubredditIds(subIds);

    const subsToScrape: string[] = [];
    const ttlMs = SCRAPE_WINDOW_MS;

    for (const sub of subredditDetails) {
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
    const channel = await this.channelRepo.findOne(
      { id: channelId },
      { populate: ['completedPosts'] },
    );
    if (channel) {
      channel.completedPosts.add(this.em.getReference<PostRef>('Post', postId));
      await this.em.flush();
    }
  }
}
