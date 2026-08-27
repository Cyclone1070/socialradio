import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository, EntityManager } from '@mikro-orm/postgresql';
import { Channel } from './entities/channel.entity';
import {
  Segment,
  TalkSegment,
  MusicSegment,
  AdSegment,
  JingleSegment,
} from './entities/segment.entity';
import {
  ChannelSchema,
  SegmentSchema,
} from '../infrastructure/database/schemas/channel.schema';
import { QueueService } from './queue.service';
import { MediaContract } from '../domain';
import { createServiceLogger } from '../infrastructure/logging/logging.module';

export interface NextTrackData {
  segmentId: string;
  type: 'talk' | 'music' | 'ad' | 'jingle';
  filePath: string;
  durationSeconds: number;
  startOffsetSeconds?: number;
  title?: string;
  artist?: string;
}

@Injectable()
export class PlaybackService {
  private readonly logger = createServiceLogger(PlaybackService.name);

  constructor(
    @InjectRepository(ChannelSchema)
    private readonly channelRepo: EntityRepository<Channel>,
    @InjectRepository(SegmentSchema)
    private readonly segmentRepo: EntityRepository<Segment>,
    private readonly em: EntityManager,
    private readonly queueService: QueueService,
    private readonly mediaService: MediaContract,
  ) {}

  async getNextTrack(
    channelId: string,
    resuming = false,
  ): Promise<NextTrackData> {
    const channel = await this.channelRepo.findOne({ id: channelId });
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    // 0. If resuming after dormancy, tail-resume into the current segment
    if (resuming && channel.currentSegmentId) {
      const current = await this.segmentRepo.findOne({
        id: channel.currentSegmentId,
      });
      if (current) {
        const offset = Math.max(0, (current.durationSeconds || 30) - 15);
        return {
          segmentId: current.id,
          type: this.getSegmentType(current),
          filePath: current.audioUrl || '',
          durationSeconds: current.durationSeconds || 0,
          startOffsetSeconds: offset,
          title: (current as MusicSegment).title,
          artist: (current as MusicSegment).artist,
        };
      }
    }

    // 1. Find Next Segment in Queue
    let segment: Segment | null = null;
    if (channel.currentSegmentId) {
      const current = await this.segmentRepo.findOne({
        id: channel.currentSegmentId,
      });
      if (current) {
        segment = await this.segmentRepo.findOne(
          { channel: channelId, playOrder: { $gt: current.playOrder } },
          { orderBy: { playOrder: 'ASC' } },
        );
      }
    } else {
      // First track for brand-new channel
      segment = await this.segmentRepo.findOne(
        { channel: channelId },
        { orderBy: { playOrder: 'ASC' } },
      );
    }

    // 2. Queue Exhausted / Empty Fallback
    if (!segment) {
      process.stderr.write(
        `[PlaybackService] Queue empty for ${channelId}, calling bufferAhead...\n`,
      );
      this.logger.info(
        { channelId, reason: 'empty-queue' },
        'bufferAhead triggered',
      );
      await this.queueService.bufferAhead(channelId);
      process.stderr.write(
        `[PlaybackService] bufferAhead finished for ${channelId}\n`,
      );
      segment = await this.segmentRepo.findOne(
        { channel: channelId },
        { orderBy: { playOrder: 'ASC' } },
      );
    }

    if (!segment) {
      const jingle = await this.mediaService.getRandomJingle();
      return {
        segmentId: 'fallback-jingle',
        type: 'jingle',
        filePath: jingle.filePath,
        durationSeconds: jingle.durationSeconds,
        title: 'Station ID',
        artist: 'Social Radio',
      };
    }

    // 3. Update Channel Playhead State
    channel.currentSegmentId = segment.id;
    await this.em.flush();

    // 4. Trigger Low Runway Replenishment
    const remainingCount = await this.segmentRepo.count({
      channel: channelId,
      playOrder: { $gt: segment.playOrder },
    });
    if (remainingCount < 4) {
      this.logger.info(
        { channelId, reason: 'low-runway' },
        'bufferAhead triggered',
      );
      this.queueService.bufferAhead(channelId).catch(() => {});
    }

    // 5. Prune Consumed Segments
    await this.pruneConsumed(channelId, segment.playOrder);

    return {
      segmentId: segment.id,
      type: this.getSegmentType(segment),
      filePath: segment.audioUrl || '',
      durationSeconds: segment.durationSeconds || 0,
      title: (segment as MusicSegment).title,
      artist: (segment as MusicSegment).artist,
    };
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

  private getSegmentType(segment: Segment): 'talk' | 'music' | 'ad' | 'jingle' {
    if (segment instanceof TalkSegment) return 'talk';
    if (segment instanceof MusicSegment) return 'music';
    if (segment instanceof AdSegment) return 'ad';
    if (segment instanceof JingleSegment) return 'jingle';
    return 'music';
  }
}
