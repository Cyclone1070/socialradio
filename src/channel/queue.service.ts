import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import { RequestContext } from '@mikro-orm/core';
import { APICallError, RetryError } from 'ai';
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
const ACTIVE_SUB_POOL_TARGET = 20; // Maximum active subreddits with available posts per channel

/**
 * QueueService manages channel segment generation and queue replenishment.
 * Cycle pattern: [1-2 Talk segments] -> [1-2 Music tracks] -> [1-2 Ads] -> [1 Jingle].
 * Buffer rule: maintains pre-generated segments ahead of the live playhead.
 * Rescrape rule: Lazy 20-sub pool rotation prior to topic clustering.
 */
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

  private readonly inFlightBuffers = new Map<string, Promise<void>>();

  async bufferAhead(channelId: string): Promise<void> {
    const existing = this.inFlightBuffers.get(channelId);
    if (existing) {
      this.logger.debug(
        { channelId },
        'bufferAhead already in progress for channel, reusing in-flight batch',
      );
      return existing;
    }

    // Buffering runs detached from the request that triggered it, so it gets
    // its own MikroORM context instead of relying on the caller's.
    const promise = RequestContext.create(this.em, async () => {
      try {
        await this.doBufferAhead(channelId);
      } finally {
        this.inFlightBuffers.delete(channelId);
      }
    });

    this.inFlightBuffers.set(channelId, promise);
    return promise;
  }

  private async doBufferAhead(channelId: string): Promise<void> {
    const lastItem = await this.segmentRepo.findOne(
      { channelId },
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
    process.stderr.write(
      `[QueueService] appendTalk called for channel ${channelId}, playOrder ${playOrder}\n`,
    );
    const triedPostIds = new Set<string>();

    while (true) {
      process.stderr.write(
        `[QueueService] Looking for pending topic segment...\n`,
      );
      const talkCluster = await this.findPendingTopicSegment(
        channelId,
        triedPostIds,
      );
      if (!talkCluster) {
        process.stderr.write(
          `[QueueService] No pending topic segment found. Checking pool deficit...\n`,
        );
        await this.checkAndScrapePoolDeficit(channelId, triedPostIds);
        return null;
      }

      process.stderr.write(
        `[QueueService] Found topic cluster: ${talkCluster.id} with ${talkCluster.posts.length} post(s). Marking completed...\n`,
      );
      // Step 1: Mark posts completed in DB immediately upon selection
      for (const p of talkCluster.posts) {
        triedPostIds.add(p.id);
        await this.markPostCompletedForChannel(channelId, p.id);
      }

      // Step 2: Check pool health directly from DB state (now reflecting consumed posts)
      process.stderr.write(
        `[QueueService] Checking pool deficit after consumption...\n`,
      );
      await this.checkAndScrapePoolDeficit(channelId, triedPostIds);

      // Step 3: Synthesize voice track
      try {
        process.stderr.write(
          `[QueueService] Starting generateTalkVoiceTrack...\n`,
        );
        const { voiceTrack, scriptObj } = await this.generateTalkVoiceTrack(
          talkCluster.posts,
        );
        process.stderr.write(
          `[QueueService] Voice track generated: ${voiceTrack.filePath}, persisting TalkSegment...\n`,
        );
        const talkItem = new TalkSegment(talkCluster.id, 'ready');
        talkItem.channelId = channelId;
        talkItem.playOrder = playOrder;
        talkItem.audioUrl = voiceTrack.filePath;
        talkItem.durationSeconds = voiceTrack.durationSeconds;
        talkItem.script = scriptObj.turns;
        const nextOrder = await this.persistSegmentWithOrderRetry(
          talkItem,
          channelId,
          playOrder,
        );
        process.stderr.write(
          `[QueueService] TalkSegment persisted successfully with status 'ready'!\n`,
        );
        return nextOrder;
      } catch (err) {
        process.stderr.write(
          `[QueueService] voice generation failed: ${err instanceof Error ? err.stack || err.message : String(err)}\n`,
        );
        const failureContext = {
          channelId,
          clusterId: talkCluster.id,
          err: err instanceof Error ? err : new Error(String(err)),
        };

        if (isRetryableLlmFailure(err)) {
          this.logger.warn(
            failureContext,
            'voice generation failed, will retry when the queue runs low again',
          );
        } else {
          this.logger.error(
            failureContext,
            'voice generation failed and will keep failing until the provider configuration is fixed (model retired, key rejected, provider refusing)',
          );
        }

        // Filler covers the gap, so the post must go back into the pool: retry is
        // demand driven and needs something left to retry when the filler runs low.
        await this.releasePostLease(
          channelId,
          talkCluster.posts.map((p) => p.id),
        );
        // Continue loop to try the next available unplayed topic cluster
      }
    }
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
            turns: [{ speaker: 'Dave', text: rawScript }],
          }
        : rawScript;

    const voiceTrack = await this.voiceContract.synthesizeScript(
      scriptObj,
      filePath,
    );
    return { voiceTrack, scriptObj };
  }

  private async persistSegmentWithOrderRetry(
    item: Segment,
    channelId: string,
    playOrder: number,
  ): Promise<number> {
    try {
      await this.em.persist(item).flush();
      return playOrder + 1;
    } catch (err: unknown) {
      const errStr = String(err);
      if (
        (typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          (err as { code: string }).code === '23505') ||
        errStr.includes('unique constraint') ||
        errStr.includes('duplicate key')
      ) {
        this.logger.warn(
          { channelId, playOrder },
          'playOrder collision detected, advancing to latest order',
        );
        const latest = await this.segmentRepo.findOne(
          { channelId },
          { orderBy: { playOrder: 'DESC' } },
        );
        item.playOrder = (latest?.playOrder ?? playOrder) + 1;
        await this.em.persist(item).flush();
        return item.playOrder + 1;
      }
      throw err;
    }
  }

  public async ensureInstantFiller(
    channelId: string,
    minCount: number = 6,
  ): Promise<void> {
    const existingCount = await this.segmentRepo.count({
      channelId,
    });
    if (existingCount >= minCount) {
      return;
    }

    const lastItem = await this.segmentRepo.findOne(
      { channelId },
      { orderBy: { playOrder: 'DESC' } },
    );
    let nextPlayOrder = lastItem ? lastItem.playOrder + 1 : 1;

    const needed = minCount - existingCount;
    for (let i = 0; i < needed; i++) {
      try {
        if (i % 3 === 0) {
          nextPlayOrder = await this.appendJingle(channelId, nextPlayOrder);
        } else if (i % 3 === 1) {
          nextPlayOrder = await this.appendAd(channelId, nextPlayOrder);
        } else {
          nextPlayOrder = await this.appendMusic(channelId, nextPlayOrder);
        }
      } catch {
        // Fallback: create emergency static jingle segment if media pool is unavailable
        const fallbackItem = new JingleSegment();
        fallbackItem.channelId = channelId;
        fallbackItem.playOrder = nextPlayOrder;
        fallbackItem.audioUrl = 'jingles/station-id.mp3';
        fallbackItem.durationSeconds = 10;
        nextPlayOrder = await this.persistSegmentWithOrderRetry(
          fallbackItem,
          channelId,
          nextPlayOrder,
        );
      }
    }
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
    const musicItem = new MusicSegment(music.title, music.artist);
    musicItem.channelId = channelId;
    musicItem.playOrder = playOrder;
    musicItem.audioUrl = music.filePath;
    musicItem.durationSeconds = music.durationSeconds;
    return await this.persistSegmentWithOrderRetry(
      musicItem,
      channelId,
      playOrder,
    );
  }

  private async appendAd(
    channelId: string,
    playOrder: number,
  ): Promise<number> {
    const ad = await this.mediaService.getRandomAd();
    const adItem = new AdSegment();
    adItem.channelId = channelId;
    adItem.playOrder = playOrder;
    adItem.audioUrl = ad.filePath;
    adItem.durationSeconds = ad.durationSeconds;
    return await this.persistSegmentWithOrderRetry(
      adItem,
      channelId,
      playOrder,
    );
  }

  private async appendJingle(
    channelId: string,
    playOrder: number,
  ): Promise<number> {
    const jingle = await this.mediaService.getRandomJingle();
    const jingleItem = new JingleSegment();
    jingleItem.channelId = channelId;
    jingleItem.playOrder = playOrder;
    jingleItem.audioUrl = jingle.filePath;
    jingleItem.durationSeconds = jingle.durationSeconds;
    return await this.persistSegmentWithOrderRetry(
      jingleItem,
      channelId,
      playOrder,
    );
  }

  public async findPendingTopicSegment(
    channelId: string,
    excludedPostIds: Set<string> = new Set(),
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
    const completedPostIds = new Set([
      ...completedPosts.map((p: PostRef) => p.id),
      ...excludedPostIds,
    ]);

    const allPosts = await this.contentContract.getPostsBySubredditIds(subIds);
    const unplayedPosts = allPosts.filter((p) => !completedPostIds.has(p.id));
    if (unplayedPosts.length === 0) return null;

    const segments = clusterPosts(unplayedPosts);
    return segments[0] || null;
  }

  public async checkAndScrapePoolDeficit(
    channelId: string,
    excludedPostIds: Set<string> = new Set(),
  ): Promise<void> {
    const channel = await this.channelRepo.findOne(
      { id: channelId },
      { populate: ['subreddits', 'completedPosts'] },
    );
    if (!channel) return;
    const subreddits = channel.subreddits.getItems();
    const subIds = subreddits.map((s: SubredditRef) => s.id);
    if (subIds.length === 0) return;

    const completedPosts = channel.completedPosts.getItems();
    const completedPostIds = new Set([
      ...completedPosts.map((p: PostRef) => p.id),
      ...excludedPostIds,
    ]);

    const subredditDetails: SubredditData[] =
      await this.contentContract.getSubredditsByIds(subIds);
    const allPosts = await this.contentContract.getPostsBySubredditIds(subIds);

    const activeSubs: SubredditData[] = [];
    const inactiveSubs: SubredditData[] = [];
    const ttlMs = SCRAPE_WINDOW_MS;
    const target = Math.min(ACTIVE_SUB_POOL_TARGET, subredditDetails.length);

    for (const sub of subredditDetails) {
      const isStale =
        !sub.lastScrapedAt || Date.now() - sub.lastScrapedAt.getTime() > ttlMs;
      const postsInSub = allPosts.filter((p) => p.subredditId === sub.id);
      const unplayedInSub = postsInSub.filter(
        (p) => !completedPostIds.has(p.id),
      );
      const isExhausted = unplayedInSub.length === 0;

      if (!isExhausted) {
        activeSubs.push(sub);
      }
      if (isStale || isExhausted) {
        inactiveSubs.push(sub);
      }
    }

    if (activeSubs.length < target) {
      const toScrapeCount = target - activeSubs.length;
      inactiveSubs.sort((a, b) => {
        if (!a.lastScrapedAt && !b.lastScrapedAt) return 0;
        if (!a.lastScrapedAt) return -1;
        if (!b.lastScrapedAt) return 1;
        return a.lastScrapedAt.getTime() - b.lastScrapedAt.getTime();
      });

      const subsToScrape = inactiveSubs
        .slice(0, toScrapeCount)
        .map((s) => s.name);

      if (subsToScrape.length > 0) {
        this.logger.info(
          { channelId, subsToScrape, activeCount: activeSubs.length },
          'background scrape chain started',
        );
        const runSequentialScrapes = async (): Promise<void> => {
          for (const name of subsToScrape) {
            await this.contentContract.scrapeSubreddit(name).catch(() => {});
          }
        };
        void runSequentialScrapes();
      }
    }
  }

  private async markPostCompletedForChannel(
    channelId: string,
    postId: string,
  ): Promise<void> {
    await this.setPostConsumed(channelId, postId, true);
  }

  /**
   * Puts a post back into the pool when its talk was never produced. Without
   * this a dead provider burns the pool one cluster at a time, and the
   * demand-driven retry has nothing left to work with.
   */
  private async releasePostLease(
    channelId: string,
    postIds: string[],
  ): Promise<void> {
    for (const postId of postIds) {
      await this.setPostConsumed(channelId, postId, false);
    }
  }

  /**
   * The pivot table belongs to the ORM, which knows its column names. Writing
   * this insert by hand is how it silently broke when the foreign keys were
   * renamed to snake_case - a repository mock accepts any string, and the catch
   * that swallowed the error logged at debug.
   */
  private async setPostConsumed(
    channelId: string,
    postId: string,
    consumed: boolean,
  ): Promise<void> {
    const channel = await this.channelRepo.findOne(
      { id: channelId },
      { populate: ['completedPosts'] },
    );
    if (!channel) return;

    const alreadyRecorded = channel.completedPosts
      .getItems()
      .some((item) => item.id === postId);
    if (alreadyRecorded === consumed) return;

    const postRef = this.em.getReference<PostRef>('Post', postId);
    if (consumed) {
      channel.completedPosts.add(postRef);
    } else {
      channel.completedPosts.remove(postRef);
    }
    await this.em.flush();
  }
}

/**
 * The provider's own verdict rather than a guess: the SDK marks 429/5xx/network
 * as retryable and refuses to retry 4xx, which is the difference between "busy,
 * try again when the filler runs low" and "this configuration is wrong".
 */
function isRetryableLlmFailure(err: unknown): boolean {
  const cause = err instanceof RetryError ? err.lastError : err;
  return APICallError.isInstance(cause) && cause.isRetryable === true;
}
