import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import { LockMode, RequestContext } from '@mikro-orm/core';
import { APICallError, RetryError } from 'ai';
import { EntityRepository, EntityManager } from '@mikro-orm/postgresql';
import { Channel, SubredditRef, PostRef } from './entities/channel.entity';
import {
  Segment,
  MusicSegment,
  TalkSegment,
  JingleSegment,
  LinerSegment,
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
import {
  ScriptData,
  ScriptRejection,
  ScriptTurn,
} from '../domain/types/script.types';
import { TalkData } from '../domain/types/audio.types';
import { SubredditData } from '../domain/types/subreddit.types';
import { randomUUID } from 'crypto';
import { buildDirective, continuityFor } from './continuity';
import { ClaimLease, ClaimStore } from '../infrastructure/lease/claim-lease';
import { breakShape, BreakKind } from './break-shape';

const SCRAPE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7-day scrape window
const ACTIVE_SUB_POOL_TARGET = 20; // Maximum active subreddits with available posts per channel

// Buffering a station costs a script generation plus a speech synthesis per turn, so
// one instance at a time does it. The beat keeps the claim alive while the batch runs;
// the cap stops a batch that is alive but wedged from renewing for ever, so the
// station frees itself instead of waiting for a restart.
const BUFFER_CLAIM_TICK_MS = 30 * 1000;
const BUFFER_CLAIM_LEASE_MS = 3 * BUFFER_CLAIM_TICK_MS;
const BUFFER_CAP_MS = 10 * 60 * 1000;

// A run starts when the queue is this short, and produces at least this much talk
// before it closes the block with a break. Both are choices, not formulas: the low
// water mark leaves room for a slow run without the station going quiet, and the
// target is what makes the breaks land about half an hour apart.
export const RUNWAY_LOW_WATER_SECONDS = 15 * 60;
// When the watchdog fires. Safety does not depend on this number - the append is
// awaited in the request that noticed, and the playhead only moves on requests -
// so it is a smoothness and retry-budget choice.
export const FILLER_RUNWAY_SECONDS = 60;
const BATCH_TALK_TARGET_SECONDS = 30 * 60;
// The loop's spin guard, above what thirty minutes of talk normally needs.
const MAX_ITEMS_PER_BATCH = 8;
// A rejection retires content for good, so one run may not walk the pool burning
// topics because the model keeps answering with something unusable.
const MAX_REJECTED_TOPICS_PER_RUN = 2;

/** One row of a block: everything needed to write a segment, and nothing else. */
export interface BlockSegmentSpec {
  kind: 'talk' | 'music' | 'jingle' | 'liner';
  audioUrl: string;
  durationSeconds: number;
  clusterId?: string;
  title?: string;
  artist?: string;
  /** The posts this conversation speaks for: marked used with the block. */
  postIds?: string[];
  /** The words of a conversation, exactly as they were spoken. */
  script?: ScriptTurn[];
  /** The outline it was written from, which the next conversation reads. */
  outline?: string;
}

function playableSeconds(duration: number | null | undefined): number {
  return typeof duration === 'number' &&
    Number.isFinite(duration) &&
    duration > 0
    ? duration
    : 0;
}

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

  /**
   * Writes a whole block in one transaction: play orders are assigned from the
   * tail read under the station lock, so two writers serialise instead of
   * colliding, and a half-written sequence never reaches the queue.
   */
  public async appendBlock(
    channelId: string,
    claimToken: string | null,
    specs: BlockSegmentSpec[],
  ): Promise<number> {
    if (specs.length === 0) return 0;

    return this.em.transactional((em) =>
      this.appendBlockIn(em, channelId, claimToken, specs),
    );
  }

  /**
   * The body of an append, on a transaction the caller already owns. The watchdog
   * needs this: its whole point is that the runway it decided on and the rows it
   * writes are the same view, so a second instance taking the lock afterwards finds
   * no hole left to fill.
   */
  private async appendBlockIn(
    em: EntityManager,
    channelId: string,
    claimToken: string | null,
    specs: BlockSegmentSpec[],
  ): Promise<number> {
    {
      const channelRepo = em.getRepository(ChannelSchema);
      const station = await channelRepo.findOne(
        { id: channelId },
        { lockMode: LockMode.PESSIMISTIC_WRITE, populate: ['completedPosts'] },
      );
      if (!station) return 0;
      if (claimToken !== null && station.bufferClaimId !== claimToken) {
        this.logger.warn(
          { channelId },
          'claim changed hands while generating, block discarded',
        );
        return 0;
      }

      const segmentRepo = em.getRepository(SegmentSchema);
      const tail = await segmentRepo.findOne(
        { channelId },
        { orderBy: { playOrder: 'DESC' } },
      );
      let playOrder = (tail?.playOrder ?? 0) + 1;
      const alreadyUsed = new Set(
        station.completedPosts?.getItems().map((post) => post.id) ?? [],
      );

      for (const spec of specs) {
        const segment = this.buildSegment(spec);
        segment.channelId = channelId;
        segment.playOrder = playOrder++;
        segment.audioUrl = spec.audioUrl;
        segment.durationSeconds = spec.durationSeconds;
        em.persist(segment);

        for (const postId of spec.postIds ?? []) {
          if (alreadyUsed.has(postId)) continue;
          station.completedPosts.add(em.getReference<PostRef>('Post', postId));
          alreadyUsed.add(postId);
        }
      }
      await em.flush();
      return specs.length;
    }
  }

  private buildSegment(spec: BlockSegmentSpec): Segment {
    switch (spec.kind) {
      case 'talk': {
        const talk = new TalkSegment(spec.clusterId, 'ready');
        talk.script = spec.script ?? null;
        talk.outline = spec.outline ?? null;
        return talk;
      }
      case 'music':
        return new MusicSegment(spec.title, spec.artist);
      case 'liner':
        return new LinerSegment();
      case 'jingle':
        return new JingleSegment();
    }
  }

  /**
   * One run per station, decided by the claim rather than by this process. The run
   * is detached from the request that noticed, so it gets its own MikroORM context.
   */
  async bufferAhead(channelId: string): Promise<void> {
    return RequestContext.create(this.em, async () => {
      const lease = await ClaimLease.take(this.bufferClaimStore(), channelId, {
        capMs: BUFFER_CAP_MS,
        tickMs: BUFFER_CLAIM_TICK_MS,
        leaseMs: BUFFER_CLAIM_LEASE_MS,
      });
      if (!lease) {
        this.logger.debug(
          { channelId },
          'another instance is buffering this station, standing aside',
        );
        return;
      }

      try {
        lease.start((reason) => {
          this.logger.warn(
            { channelId, reason },
            'buffering lost its claim, letting the run wind down',
          );
        });
        await this.run(channelId, lease);
      } finally {
        await lease.stop();
      }
    });
  }

  private bufferClaimStore(): ClaimStore {
    return {
      take: (channelId, token, staleBefore) =>
        this.channelRepo.nativeUpdate(
          {
            id: channelId,
            $or: [
              { bufferClaimId: null },
              { bufferClaimedAt: { $lt: staleBefore } },
            ],
          },
          { bufferClaimId: token, bufferClaimedAt: new Date() },
        ),
      renew: (channelId, token, at) =>
        this.channelRepo.nativeUpdate(
          { id: channelId, bufferClaimId: token },
          { bufferClaimedAt: at },
        ),
      release: async (channelId, token) => {
        await this.channelRepo.nativeUpdate(
          { id: channelId, bufferClaimId: token },
          { bufferClaimId: null, bufferClaimedAt: null },
        );
      },
    };
  }

  /**
   * The generator. Reads the runway *after* the claim, so a run that starts late
   * does not pay for work the station no longer needs, then produces conversations
   * until it has at least thirty minutes of talk and appends the whole block -
   * conversations, announcement, song - in one write.
   */
  private async run(channelId: string, lease: ClaimLease): Promise<void> {
    const runway = await this.computeRunwaySeconds(channelId);
    if (runway >= RUNWAY_LOW_WATER_SECONDS) {
      this.logger.debug(
        { channelId, runway },
        'the queue filled up while the claim was taken, run stands down',
      );
      return;
    }

    const specs: BlockSegmentSpec[] = [];
    const triedPostIds = new Set<string>();
    // What the next conversation will follow: the tail of the queue to begin with,
    // then whatever this run has just produced.
    let lastAired: { type: string; outline: string | null } | null =
      await this.readTail(channelId);
    let producedSeconds = 0;
    let consecutiveFailures = 0;
    let rejections = 0;
    let scrapeFired = false;

    while (
      producedSeconds < BATCH_TALK_TARGET_SECONDS &&
      specs.length < MAX_ITEMS_PER_BATCH
    ) {
      // The claim went: this instance is no longer the run, and nothing it has
      // made may reach the queue.
      if (lease.shouldStop) return;

      const cluster = await this.findPendingTopicSegment(
        channelId,
        triedPostIds,
      );
      if (!cluster) {
        if (!scrapeFired) {
          scrapeFired = true;
          await this.checkAndScrapePoolDeficit(channelId, triedPostIds);
        }
        break;
      }
      for (const post of cluster.posts) {
        triedPostIds.add(post.id);
      }

      const directive = buildDirective(
        continuityFor(lastAired),
        lastAired?.outline ?? null,
      );
      const outcome = await this.produceConversation(cluster, lease, directive);
      if (outcome.kind === 'claim-lost') return;

      if (outcome.kind === 'rejected') {
        rejections++;
        this.logger.warn(
          { channelId, clusterId: cluster.id, reason: outcome.reason },
          'the model rejected this topic, retiring it',
        );
        await this.retirePosts(
          channelId,
          cluster.posts.map((post) => post.id),
        );
        if (rejections >= MAX_REJECTED_TOPICS_PER_RUN) break;
        continue;
      }

      if (outcome.kind === 'failed') {
        consecutiveFailures++;
        if (consecutiveFailures >= 2) break;
        continue;
      }

      specs.push(outcome.spec);
      lastAired = {
        type: 'talk',
        outline: outcome.spec.outline?.trim() || null,
      };
      producedSeconds += outcome.spec.durationSeconds;
      consecutiveFailures = 0;
    }

    // Nothing was produced, so there is no block to end and nothing to write.
    if (specs.length === 0) return;

    specs.push(
      ...(await this.drawBreak(
        channelId,
        specs[specs.length - 1].kind,
        'break',
      )),
    );
    await this.appendBlock(channelId, lease.token, specs);
  }

  /**
   * A conversation costs a script and a speech, and the claim decides whether this
   * instance is still the one that should be paying for them.
   */
  private async produceConversation(
    cluster: TalkCluster,
    lease: ClaimLease,
    directive: string,
  ): Promise<
    | { kind: 'ready'; spec: BlockSegmentSpec }
    | { kind: 'claim-lost' }
    | { kind: 'rejected'; reason: string }
    | { kind: 'failed' }
  > {
    const posts = cluster.posts;
    try {
      const outcome = await this.generateTalkVoiceTrack(
        posts,
        lease,
        directive,
      );
      if (outcome === null) return { kind: 'claim-lost' };
      if (isScriptRejection(outcome)) {
        return { kind: 'rejected', reason: outcome.reason };
      }
      const { voiceTrack, scriptObj } = outcome;
      return {
        kind: 'ready',
        spec: {
          kind: 'talk',
          clusterId: cluster.id,
          postIds: posts.map((post) => post.id),
          audioUrl: voiceTrack.filePath,
          durationSeconds: voiceTrack.durationSeconds,
          script: scriptObj.turns,
          outline: scriptObj.outline,
        },
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const context = { channelId: cluster.id, err: error };
      if (isRetryableLlmFailure(err)) {
        this.logger.warn(
          { ...context, clusterId: cluster.id },
          'voice generation failed, the run will retry once before it gives up',
        );
      } else {
        this.logger.error(
          { ...context, clusterId: cluster.id },
          'voice generation failed and will keep failing until the provider configuration is fixed (model retired, key rejected, provider refusing)',
        );
      }
      return { kind: 'failed' };
    }
  }

  /**
   * Draws the media for a break. A missing pool costs the break a piece, never the
   * conversations: the block is appended either way.
   */
  private async drawBreak(
    channelId: string,
    previousKind: BlockSegmentSpec['kind'] | null,
    kind: BreakKind,
  ): Promise<BlockSegmentSpec[]> {
    const shape = breakShape(previousKind, kind);
    const specs: BlockSegmentSpec[] = [];

    for (const item of shape) {
      try {
        if (item === 'liner') {
          const liner = await this.mediaService.getRandomLiner();
          specs.push({
            kind: 'liner',
            audioUrl: liner.filePath,
            durationSeconds: liner.durationSeconds,
          });
        } else {
          const music = await this.mediaService.getRandomMusic();
          specs.push({
            kind: 'music',
            title: music.title,
            artist: music.artist,
            audioUrl: music.filePath,
            durationSeconds: music.durationSeconds,
          });
        }
      } catch (err) {
        this.logger.warn(
          {
            channelId,
            item,
            err: err instanceof Error ? err.message : String(err),
          },
          'a break pool is empty, leaving that part of the break out',
        );
      }
    }
    return specs;
  }

  /**
   * Minutes of airtime left from this moment: the rest of what is playing now plus
   * everything queued behind it. One function, called by the trigger, the run's gate
   * and the watchdog, because two implementations drift silently.
   */
  public async computeRunwaySeconds(channelId: string): Promise<number> {
    const channel = await this.channelRepo.findOne({ id: channelId });
    if (!channel) return 0;

    const current = channel.currentSegmentId
      ? await this.segmentRepo.findOne({ id: channel.currentSegmentId })
      : await this.segmentRepo.findOne(
          { channelId, playOrder: { $gte: channel.currentPlayOrder ?? 1 } },
          { orderBy: { playOrder: 'ASC' } },
        );

    const ahead = await this.segmentRepo.find(
      { channelId, playOrder: { $gt: current?.playOrder ?? 0 } },
      { orderBy: { playOrder: 'ASC' } },
    );
    const aheadSeconds = ahead.reduce(
      (total, segment) => total + playableSeconds(segment.durationSeconds),
      0,
    );
    if (!current) return aheadSeconds;

    const startedAt = channel.playheadStartedAt?.getTime() ?? Date.now();
    const elapsed = Math.max(0, (Date.now() - startedAt) / 1000);
    return (
      Math.max(0, playableSeconds(current.durationSeconds) - elapsed) +
      aheadSeconds
    );
  }

  /**
   * Retires posts whose topic the model refused. A refusal is a statement about the
   * content, so the posts are spent rather than postponed - otherwise every run
   * re-chews the same poisoned topic and the pool never shrinks honestly.
   */
  public async retirePosts(
    channelId: string,
    postIds: string[],
  ): Promise<void> {
    if (postIds.length === 0) return;

    await this.em.transactional(async (em) => {
      const channelRepo = em.getRepository(ChannelSchema);
      const station = await channelRepo.findOne(
        { id: channelId },
        { populate: ['completedPosts'] },
      );
      if (!station) return;

      const alreadyUsed = new Set(
        station.completedPosts.getItems().map((post) => post.id),
      );
      for (const postId of postIds) {
        if (alreadyUsed.has(postId)) continue;
        station.completedPosts.add(em.getReference<PostRef>('Post', postId));
        alreadyUsed.add(postId);
      }
      await em.flush();
    });
  }

  /** What aired last, as far as the next conversation is concerned. */
  private async readTail(
    channelId: string,
  ): Promise<{ type: string; outline: string | null } | null> {
    const tail = await this.segmentRepo.findOne(
      { channelId },
      { orderBy: { playOrder: 'DESC' } },
    );
    if (!tail) return null;
    // Only a conversation has an outline; everything else ends its own sentence.
    const outline =
      tail.type === 'talk' ? ((tail as TalkSegment).outline ?? null) : null;
    return { type: tail.type, outline };
  }

  private async generateTalkVoiceTrack(
    posts: PostData[],
    lease: ClaimLease,
    directive: string,
  ): Promise<
    { voiceTrack: TalkData; scriptObj: ScriptData } | ScriptRejection | null
  > {
    // Nothing below is free, and the claim decides whether this instance is still
    // the one that should be paying. Null means stop the run.
    if (lease.shouldStop) return null;
    const comments = await this.contentContract.getCommentsByPostIds(
      posts.map((p) => p.id),
    );
    const rawScript = await this.scriptContract.generateScript(
      posts,
      comments,
      directive,
    );
    if (isScriptRejection(rawScript)) {
      return rawScript;
    }

    const filePath = `audio/talk-${randomUUID()}.mp3`;
    const scriptObj: ScriptData =
      typeof rawScript === 'string'
        ? {
            postId: posts[0].id,
            turns: [{ speaker: 'Dave', text: rawScript }],
          }
        : rawScript;

    // The script is written; the speech is the next thing that costs money, so the
    // claim is checked once more before spending it.
    if (lease.shouldStop) return null;
    const voiceTrack = await this.voiceContract.synthesizeScript(
      scriptObj,
      filePath,
    );
    return { voiceTrack, scriptObj };
  }

  /**
   * The watchdog. Only it ever writes filler, and for one reason: the station is
   * about to go quiet. It is awaited by the request that noticed, so the manifest
   * that request returns already has the filler in it.
   */
  public async ensureFiller(channelId: string): Promise<void> {
    // One transaction: the runway is read under the station lock and the filler is
    // written before that lock is released, so two instances that both noticed an
    // empty station cannot both fill it. The second one takes the lock, sees the
    // rows the first one wrote, and finds nothing left to do.
    await this.em.transactional(async (em) => {
      const channelRepo = em.getRepository(ChannelSchema);
      const station = await channelRepo.findOne(
        { id: channelId },
        { lockMode: LockMode.PESSIMISTIC_WRITE, populate: ['completedPosts'] },
      );
      if (!station) return;

      const runway = await this.computeRunwaySeconds(channelId);
      if (runway >= FILLER_RUNWAY_SECONDS) return;

      const tail = await em
        .getRepository(SegmentSchema)
        .findOne({ channelId }, { orderBy: { playOrder: 'DESC' } });
      this.logger.warn(
        {
          channelId,
          runwaySeconds: Math.round(runway),
          deficitSeconds: Math.round(FILLER_RUNWAY_SECONDS - runway),
        },
        'the station was about to run out of airtime, filling the gap',
      );

      // No claim: the watchdog has to work while a run is still generating.
      const specs = await this.drawBreak(
        channelId,
        tail?.type ?? null,
        'filler',
      );
      await this.appendBlockIn(em, channelId, null, specs);
    });
  }

  public async findPendingTopicSegment(
    channelId: string,
    excludedPostIds: Set<string> = new Set(),
    channelRepo: EntityRepository<Channel> = this.channelRepo,
  ): Promise<TalkCluster | null> {
    const channel = await channelRepo.findOne(
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
}

/**
 * A refusal by the model, which says nothing about the next topic. Takes any
 * value because the caller may hold either a raw script outcome or the voice
 * track's own result.
 */
function isScriptRejection(outcome: unknown): outcome is ScriptRejection {
  return (
    typeof outcome === 'object' && outcome !== null && 'rejected' in outcome
  );
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
