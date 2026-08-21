import { Injectable } from '@nestjs/common';
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

  async getNextTrack(channelId: string): Promise<NextTrackData> {
    const channel = await this.channelRepo.findOne({ id: channelId });
    if (!channel) {
      throw new Error('Channel not found');
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
    }

    if (!segment) {
      segment = await this.segmentRepo.findOne(
        { channel: channelId },
        { orderBy: { playOrder: 'ASC' } },
      );
    }

    // 2. Queue Exhausted / Empty Fallback
    if (!segment) {
      this.logger.info(
        { channelId, reason: 'empty-queue' },
        'bufferAhead triggered',
      );
      await this.queueService.bufferAhead(channelId);
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

    // 3. Status Check for Talk Segment
    if (segment instanceof TalkSegment) {
      if (segment.status === 'generating') {
        const jingle = await this.mediaService.getRandomJingle();
        return {
          segmentId: 'interim-jingle',
          type: 'jingle',
          filePath: jingle.filePath,
          durationSeconds: jingle.durationSeconds,
          title: 'Station ID',
          artist: 'Social Radio',
        };
      }
      if (segment.status === 'failed') {
        const next = await this.segmentRepo.findOne(
          { channel: channelId, playOrder: { $gt: segment.playOrder } },
          { orderBy: { playOrder: 'ASC' } },
        );
        if (next) segment = next;
      }
    }

    // 4. Update Channel Playhead State
    channel.currentSegmentId = segment.id;
    await this.em.flush();

    // 5. Trigger Low Runway Replenishment
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

    // 6. Prune Consumed Segments
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
