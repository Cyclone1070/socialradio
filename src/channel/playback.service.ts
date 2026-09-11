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
    const segmentCount = await this.segmentRepo.count({ channel: channelId });
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

    const manifest = await this.em.transactional(async (em) => {
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
        if (!channel.playheadStartedAt) {
          // Brand new channel starting broadcast for the very first time: start at track 1 (ASC)
          anchorSegment = await this.segmentRepo.findOne(
            { channel: channelId },
            { orderBy: { playOrder: 'ASC' } },
          );
        } else if (channel.currentPlayOrder) {
          // In-flight channel where currentSegmentId was cleared/lost: resume from currentPlayOrder
          anchorSegment = await this.segmentRepo.findOne(
            {
              channel: channelId,
              playOrder: { $gte: channel.currentPlayOrder },
            },
            { orderBy: { playOrder: 'ASC' } },
          );
        }
        if (!anchorSegment) {
          // Both pointers missing on an active station: anchor to live runway edge
          const latestBatch = await this.segmentRepo.find(
            { channel: channelId },
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

      const lastActive = channel.lastActiveAt ?? now;
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
              channel: channelId,
              playOrder: { $gte: channel.currentPlayOrder },
            },
            { orderBy: { playOrder: 'ASC' } },
          );
        }
        if (!currentSegment) {
          const latestBatch = await this.segmentRepo.find(
            { channel: channelId },
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
          const duration = currentSegment.durationSeconds || 10;
          const elapsed =
            (now.getTime() - channel.playheadStartedAt.getTime()) / 1000;
          if (elapsed >= duration) {
            const nextSegment: Segment | null = await this.segmentRepo.findOne(
              {
                channel: channelId,
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
          channel: channelId,
          playOrder: { $gt: currentSegment.playOrder },
        });
        if (remainingCount < 4) {
          this.logger.info(
            { channelId, reason: 'low-runway' },
            'bufferAhead triggered',
          );
          needsReplenishment = true;
        }

        await this.pruneConsumed(channelId, currentSegment.playOrder);
      } else {
        needsReplenishment = true;
      }

      let windowSegments = currentSegment
        ? await this.segmentRepo.find(
            {
              channel: channelId,
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
          { channel: channelId, playOrder: { $gte: minOrder } },
          { orderBy: { playOrder: 'ASC' }, limit: 6 },
        );
        if (windowSegments.length === 0) {
          windowSegments = await this.segmentRepo.find(
            { channel: channelId },
            { orderBy: { playOrder: 'ASC' }, limit: 6 },
          );
        }
        if (!currentSegment && windowSegments.length > 0) {
          currentSegment = windowSegments[0];
          channel.currentSegmentId = currentSegment.id;
          channel.currentPlayOrder = currentSegment.playOrder;
          channel.playheadStartedAt = now;
        }
      }

      await em.flush();

      let prevType: string | null = null;
      const hlsSegments = windowSegments
        .filter((s) => Boolean(s.audioUrl))
        .map((s, idx) => {
          const currentType = s.type;
          const isDiscontinuity =
            idx > 0 && prevType !== null && prevType !== currentType;
          prevType = currentType;
          return {
            durationSeconds: s.durationSeconds || 10,
            url: this.resolveAudioUrl(s.audioUrl),
            discontinuity: isDiscontinuity,
          };
        });

      return generateHlsManifest({
        mediaSequence:
          currentSegment?.playOrder ?? channel.currentPlayOrder ?? 0,
        segments: hlsSegments,
      });
    });

    if (needsReplenishment) {
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
      channel: channelId,
      playOrder: { $lt: cutoffPlayOrder },
    });
  }
}
