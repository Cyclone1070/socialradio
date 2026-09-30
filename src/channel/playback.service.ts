import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository, EntityManager } from '@mikro-orm/postgresql';
import { LockMode } from '@mikro-orm/core';
import { Segment } from './entities/segment.entity';
import {
  ChannelSchema,
  SegmentSchema,
} from '../infrastructure/database/schemas/channel.schema';
import { QueueService } from './queue.service';
import { createServiceLogger } from '../infrastructure/logging/logging.module';
import { generateHlsManifest } from './utils/hls-manifest.util';
import { StorageService } from '../infrastructure/storage/storage.service';

export interface LiveManifestResult {
  manifest: string;
  visibility: 'public' | 'private';
}

/**
 * PlaybackService manages live RFC 8216 HLS streaming and sliding window playlists.
 * - Lazy Virtual Clock: playhead advances on-demand based on elapsed wall-clock time between manifest requests.
 * - Idle Freeze & Wakeup: freezes playhead if no requests for > 10 minutes.
 * - Edge Caching: Cache-Control public, max-age=2, s-maxage=2.
 */
@Injectable()
export class PlaybackService {
  private readonly logger = createServiceLogger(PlaybackService.name);

  constructor(
    @InjectRepository(SegmentSchema)
    private readonly segmentRepo: EntityRepository<Segment>,
    private readonly em: EntityManager,
    private readonly queueService: QueueService,
    private readonly storageService: StorageService,
  ) {}

  async getLiveManifest(
    channelId: string,
    user?: { id: string; role?: string } | null,
  ): Promise<LiveManifestResult> {
    const existing = await this.em.findOne(ChannelSchema, { id: channelId });
    if (!existing) {
      throw new NotFoundException('Channel not found');
    }

    // Rule A-3: Public vs Private Access Control
    if (existing.visibility === 'private') {
      if (!user) {
        throw new UnauthorizedException('Unauthorized');
      }
      if (user.id !== existing.ownerId && user.role !== 'admin') {
        throw new ForbiddenException('Forbidden');
      }
    }

    // Cold Start & Emergency filler: if channel queue is empty, insert instant pre-recorded filler (takes ~2ms),
    // and fire background bufferAhead asynchronously (NEVER blocks the HTTP request path!)
    const segmentCount = await this.segmentRepo.count({ channelId });
    if (segmentCount === 0) {
      await this.queueService.ensureInstantFiller(channelId, 6);
      this.queueService.bufferAhead(channelId).catch((err) => {
        this.logger.warn(
          { channelId, err: err instanceof Error ? err.message : String(err) },
          'Background bufferAhead failed on cold start',
        );
      });
    }

    let needsReplenishment = false;

    const playheadState = await this.em.transactional(async (em) => {
      const channel = await em.findOne(
        ChannelSchema,
        { id: channelId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!channel) {
        throw new NotFoundException('Channel not found');
      }

      const now = new Date();

      // Cold Start playhead anchoring
      if (!channel.currentSegmentId || !channel.playheadStartedAt) {
        let anchorSegment: Segment | null = null;
        if (channel.currentPlayOrder) {
          // In-flight channel where playheadStartedAt or currentSegmentId was cleared/lost: resume from currentPlayOrder
          anchorSegment = await this.segmentRepo.findOne(
            {
              channelId,
              playOrder: { $gte: channel.currentPlayOrder },
            },
            { orderBy: { playOrder: 'ASC' } },
          );
        } else if (channel.currentSegmentId) {
          anchorSegment = await this.segmentRepo.findOne({
            id: channel.currentSegmentId,
          });
        } else if (!channel.playheadStartedAt) {
          // Truly brand new channel starting broadcast for the very first time: start at track 1 (ASC)
          anchorSegment = await this.segmentRepo.findOne(
            { channelId },
            { orderBy: { playOrder: 'ASC' } },
          );
        }
        if (!anchorSegment) {
          // Both pointers missing on an active station: anchor to live runway edge
          const latestBatch = await this.segmentRepo.find(
            { channelId },
            { orderBy: { playOrder: 'DESC' }, limit: 6 },
          );
          if (latestBatch.length > 0) {
            latestBatch.sort((a, b) => a.playOrder - b.playOrder);
            anchorSegment = latestBatch[0];
          }
        }
        if (anchorSegment) {
          channel.currentSegmentId = anchorSegment.id;
          channel.currentPlayOrder = anchorSegment.playOrder;
          channel.playheadStartedAt = channel.playheadStartedAt ?? now;
          channel.lastActiveAt = now;
        }
      }

      if (!channel.playheadStartedAt) {
        channel.playheadStartedAt = now;
      }

      // Idle Freeze Detection (Invariants I-2 & I-5)
      const rawTimeout = process.env.IDLE_TIMEOUT_SECONDS;
      const parsedTimeout = rawTimeout ? parseFloat(rawTimeout) : NaN;
      const idleTimeoutSeconds = Number.isFinite(parsedTimeout)
        ? parsedTimeout
        : 600;

      const lastActive =
        channel.lastActiveAt ?? channel.playheadStartedAt ?? now;
      const quietSeconds = (now.getTime() - lastActive.getTime()) / 1000;

      if (quietSeconds > idleTimeoutSeconds) {
        const elapsedBeforeFreeze =
          lastActive.getTime() +
          idleTimeoutSeconds * 1000 -
          channel.playheadStartedAt.getTime();
        channel.playheadStartedAt = new Date(
          now.getTime() - Math.max(0, elapsedBeforeFreeze),
        );
      }
      channel.lastActiveAt = now;

      // Active Playhead Time Advancement
      let currentSegment: Segment | null = null;
      if (channel.currentSegmentId) {
        currentSegment = await this.segmentRepo.findOne({
          id: channel.currentSegmentId,
        });
        if (
          currentSegment &&
          currentSegment.playOrder !== channel.currentPlayOrder
        ) {
          channel.currentPlayOrder = currentSegment.playOrder;
        }
      }

      // Orphaned playhead recovery: if currentSegmentId is invalid/deleted,
      // recover strictly starting from channel.currentPlayOrder onwards (ASC order).
      // If currentPlayOrder is also missing, recover to the live edge (latest batch).
      if (!currentSegment) {
        if (channel.currentPlayOrder) {
          currentSegment = await this.segmentRepo.findOne(
            {
              channelId,
              playOrder: { $gte: channel.currentPlayOrder },
            },
            { orderBy: { playOrder: 'ASC' } },
          );
        }
        if (!currentSegment) {
          const latestBatch = await this.segmentRepo.find(
            { channelId },
            { orderBy: { playOrder: 'DESC' }, limit: 6 },
          );
          if (latestBatch.length > 0) {
            latestBatch.sort((a, b) => a.playOrder - b.playOrder);
            currentSegment = latestBatch[0];
          }
        }
        if (currentSegment) {
          channel.currentSegmentId = currentSegment.id;
          channel.currentPlayOrder = currentSegment.playOrder;
          channel.playheadStartedAt = now;
        }
      }

      if (currentSegment) {
        while (currentSegment) {
          const duration =
            typeof currentSegment.durationSeconds === 'number' &&
            currentSegment.durationSeconds > 0
              ? currentSegment.durationSeconds
              : null;

          if (duration === null) {
            this.logger.warn(
              {
                channelId,
                segmentId: currentSegment.id,
                durationSeconds: currentSegment.durationSeconds,
              },
              'Skipping corrupted segment with non-positive or missing duration',
            );
            const nextSegment: Segment | null = await this.segmentRepo.findOne(
              {
                channelId,
                playOrder: { $gt: currentSegment.playOrder },
              },
              { orderBy: { playOrder: 'ASC' } },
            );
            if (!nextSegment) {
              channel.playheadStartedAt = now;
              break;
            }
            channel.currentSegmentId = nextSegment.id;
            channel.currentPlayOrder = nextSegment.playOrder;
            channel.playheadStartedAt = now;
            currentSegment = nextSegment;
            continue;
          }

          const elapsed =
            (now.getTime() - channel.playheadStartedAt.getTime()) / 1000;
          if (elapsed >= duration) {
            const nextSegment: Segment | null = await this.segmentRepo.findOne(
              {
                channelId,
                playOrder: { $gt: currentSegment.playOrder },
              },
              { orderBy: { playOrder: 'ASC' } },
            );
            if (!nextSegment) {
              channel.playheadStartedAt = new Date(
                now.getTime() - duration * 1000,
              );
              break;
            }
            channel.currentSegmentId = nextSegment.id;
            channel.currentPlayOrder = nextSegment.playOrder;
            channel.playheadStartedAt = new Date(
              channel.playheadStartedAt.getTime() + duration * 1000,
            );
            currentSegment = nextSegment;
          } else {
            break;
          }
        }
      }

      if (currentSegment) {
        const remainingCount = await this.segmentRepo.count({
          channelId,
          playOrder: { $gt: currentSegment.playOrder },
        });
        if (remainingCount < 4) {
          this.logger.info(
            { channelId, reason: 'low-runway' },
            'bufferAhead triggered',
          );
          needsReplenishment = true;
        }
      } else {
        needsReplenishment = true;
      }

      await em.flush();

      return {
        channel,
        currentSegment,
        needsReplenishment,
        now,
      };
    });

    let currentSegment = playheadState.currentSegment;
    const channel = playheadState.channel;
    const now = playheadState.now;

    if (currentSegment) {
      await this.pruneConsumed(channelId, currentSegment.playOrder);
    }

    let windowSegments = currentSegment
      ? await this.segmentRepo.find(
          {
            channelId,
            playOrder: { $gte: currentSegment.playOrder },
          },
          {
            orderBy: { playOrder: 'ASC' },
            limit: 6,
          },
        )
      : [];

    if (windowSegments.length === 0) {
      await this.queueService.ensureInstantFiller(channelId, 6);
      const minOrder = channel.currentPlayOrder ?? 1;
      windowSegments = await this.segmentRepo.find(
        { channelId, playOrder: { $gte: minOrder } },
        { orderBy: { playOrder: 'ASC' }, limit: 6 },
      );
      if (windowSegments.length === 0) {
        windowSegments = await this.segmentRepo.find(
          { channelId },
          { orderBy: { playOrder: 'ASC' }, limit: 6 },
        );
      }
      if (!currentSegment && windowSegments.length > 0) {
        currentSegment = windowSegments[0];
        channel.currentSegmentId = currentSegment.id;
        channel.currentPlayOrder = currentSegment.playOrder;
        channel.playheadStartedAt = now;
        await this.em.flush();
      }
    }

    let prevType: string | null = null;
    const hlsSegments = windowSegments
      .filter(
        (s) =>
          Boolean(s.audioUrl) &&
          typeof s.durationSeconds === 'number' &&
          s.durationSeconds > 0,
      )
      .map((s, idx) => {
        const currentType = s.type;
        const isDiscontinuity =
          idx > 0 && prevType !== null && prevType !== currentType;
        prevType = currentType;
        return {
          durationSeconds: s.durationSeconds,
          url: this.resolveAudioUrl(s.audioUrl),
          discontinuity: isDiscontinuity,
        };
      });

    const firstPlayableSegment = windowSegments.find(
      (s) =>
        Boolean(s.audioUrl) &&
        typeof s.durationSeconds === 'number' &&
        s.durationSeconds > 0,
    );
    const mediaSequence =
      firstPlayableSegment?.playOrder ??
      currentSegment?.playOrder ??
      channel.currentPlayOrder ??
      0;

    const manifest = generateHlsManifest({
      mediaSequence,
      segments: hlsSegments,
    });

    if (playheadState.needsReplenishment) {
      this.queueService.bufferAhead(channelId).catch((err) => {
        this.logger.warn(
          { channelId, err: err instanceof Error ? err.message : String(err) },
          'Background bufferAhead replenishment failed',
        );
      });
    }

    return {
      manifest,
      visibility: existing.visibility,
    };
  }

  private resolveAudioUrl(urlOrKey: string | null): string {
    if (!urlOrKey) return '';
    if (urlOrKey.startsWith('http://') || urlOrKey.startsWith('https://')) {
      return urlOrKey;
    }
    return this.storageService.getPublicUrl(urlOrKey);
  }

  private async pruneConsumed(
    channelId: string,
    currentPlayOrder: number,
  ): Promise<void> {
    const cutoffPlayOrder = currentPlayOrder - 100;
    if (cutoffPlayOrder <= 0) return;

    await this.segmentRepo.nativeDelete({
      channelId,
      playOrder: { $lt: cutoffPlayOrder },
    });
  }
}
