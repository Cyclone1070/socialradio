import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, LessThan } from 'typeorm';
import { Channel } from './entities/channel.entity';
import {
  Segment,
  TalkSegment,
  SongSegment,
  AdSegment,
  JingleSegment,
} from './entities/segment.entity';
import { QueueService } from './queue.service';
import { MediaService } from '../media/media.service';
import { createServiceLogger } from '../infrastructure/logging/logging.module';

export interface NextTrackData {
  segmentId: string;
  type: 'talk' | 'song' | 'ad' | 'jingle';
  filePath: string;
  durationSeconds: number;
  startOffsetSeconds: number;
  title?: string;
  artist?: string;
}

@Injectable()
export class PlaybackService {
  private readonly logger = createServiceLogger(PlaybackService.name);

  constructor(
    @InjectRepository(Channel)
    private readonly channelRepo: Repository<Channel>,
    @InjectRepository(Segment)
    private readonly segmentRepo: Repository<Segment>,
    private readonly queueService: QueueService,
    private readonly mediaService: MediaService,
  ) {}

  async getNextTrack(
    channelId: string,
    now: Date = new Date(),
  ): Promise<NextTrackData> {
    const channel = await this.channelRepo.findOneBy({ id: channelId });
    if (!channel) {
      throw new Error('Channel not found');
    }

    // 1. Idle Detection & Tail-Resume
    if (channel.currentSegmentStartedAt && channel.currentSegmentId) {
      const elapsed =
        (now.getTime() - channel.currentSegmentStartedAt.getTime()) / 1000;
      const activeSeg = await this.segmentRepo.findOne({
        where: { id: channel.currentSegmentId },
      });

      if (activeSeg && activeSeg.durationSeconds) {
        const overdue = elapsed - activeSeg.durationSeconds;
        if (overdue > 120 && activeSeg.durationSeconds > 20) {
          const wrapDuration = Math.floor(Math.random() * 11) + 10; // 10 to 20s
          const startOffsetSeconds = Math.max(
            0,
            activeSeg.durationSeconds - wrapDuration,
          );
          channel.currentSegmentStartedAt = new Date(
            now.getTime() - startOffsetSeconds * 1000,
          );
          channel.lastRequestedAt = now;
          await this.channelRepo.save(channel);

          return {
            segmentId: activeSeg.id,
            type: this.getSegmentType(activeSeg),
            filePath: activeSeg.audioUrl || '',
            durationSeconds: activeSeg.durationSeconds,
            startOffsetSeconds,
            title: (activeSeg as SongSegment).title,
            artist: (activeSeg as SongSegment).artist,
          };
        }
      }
    }

    // 2. Find Next Segment in Queue
    let segment: Segment | null = null;
    if (channel.currentSegmentId) {
      const current = await this.segmentRepo.findOne({
        where: { id: channel.currentSegmentId },
      });
      if (current) {
        segment = await this.segmentRepo.findOne({
          where: { channelId, playOrder: MoreThan(current.playOrder) },
          order: { playOrder: 'ASC' },
        });
      }
    }

    if (!segment) {
      segment = await this.segmentRepo.findOne({
        where: { channelId },
        order: { playOrder: 'ASC' },
      });
    }

    // 3. Queue Exhausted / Empty Fallback
    if (!segment) {
      this.logger.info(
        { channelId, reason: 'empty-queue' },
        'bufferAhead triggered',
      );
      await this.queueService.bufferAhead(channelId);
      segment = await this.segmentRepo.findOne({
        where: { channelId },
        order: { playOrder: 'ASC' },
      });
    }

    if (!segment) {
      const jingle = await this.mediaService.getRandomJingle();
      return {
        segmentId: 'fallback-jingle',
        type: 'jingle',
        filePath: jingle.filePath,
        durationSeconds: jingle.durationSeconds,
        startOffsetSeconds: 0,
        title: 'Station ID',
        artist: 'Social Radio',
      };
    }

    // 4. Status Check for Talk Segment
    if (segment instanceof TalkSegment) {
      if (segment.status === 'generating') {
        const jingle = await this.mediaService.getRandomJingle();
        return {
          segmentId: 'interim-jingle',
          type: 'jingle',
          filePath: jingle.filePath,
          durationSeconds: jingle.durationSeconds,
          startOffsetSeconds: 0,
          title: 'Station ID',
          artist: 'Social Radio',
        };
      }
      if (segment.status === 'failed') {
        const next = await this.segmentRepo.findOne({
          where: { channelId, playOrder: MoreThan(segment.playOrder) },
          order: { playOrder: 'ASC' },
        });
        if (next) segment = next;
      }
    }

    // 5. Update Channel Playhead State
    channel.currentSegmentId = segment.id;
    channel.currentSegmentStartedAt = now;
    channel.lastRequestedAt = now;
    await this.channelRepo.save(channel);

    // 6. Trigger Low Runway Replenishment
    const remainingCount = await this.segmentRepo.count({
      where: { channelId, playOrder: MoreThan(segment.playOrder) },
    });
    if (remainingCount < 4) {
      this.logger.info(
        { channelId, reason: 'low-runway' },
        'bufferAhead triggered',
      );
      this.queueService.bufferAhead(channelId).catch(() => {});
    }

    // 7. Prune Consumed Segments
    await this.pruneConsumed(channelId, segment.playOrder);

    return {
      segmentId: segment.id,
      type: this.getSegmentType(segment),
      filePath: segment.audioUrl || '',
      durationSeconds: segment.durationSeconds || 0,
      startOffsetSeconds: 0,
      title: (segment as SongSegment).title,
      artist: (segment as SongSegment).artist,
    };
  }

  private async pruneConsumed(
    channelId: string,
    currentPlayOrder: number,
  ): Promise<void> {
    const cutoffPlayOrder = currentPlayOrder - 100;
    if (cutoffPlayOrder <= 0) return;

    await this.segmentRepo.delete({
      channelId,
      playOrder: LessThan(cutoffPlayOrder),
    });
  }

  private getSegmentType(segment: Segment): 'talk' | 'song' | 'ad' | 'jingle' {
    if (segment instanceof TalkSegment) return 'talk';
    if (segment instanceof SongSegment) return 'song';
    if (segment instanceof AdSegment) return 'ad';
    if (segment instanceof JingleSegment) return 'jingle';
    return 'song';
  }
}
