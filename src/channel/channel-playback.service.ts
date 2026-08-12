import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, LessThan, IsNull } from 'typeorm';
import { Channel } from './entities/channel.entity';
import { Segment } from './entities/segment.entity';
import { ChunkerService } from './chunker.service';
import { QueueGeneratorService } from './queue-generator.service';
import { createServiceLogger } from '../logging/logging.module';

@Injectable()
export class ChannelPlaybackService {
  private readonly logger = createServiceLogger(ChannelPlaybackService.name);

  constructor(
    @InjectRepository(Channel)
    private readonly channelRepo: Repository<Channel>,
    @InjectRepository(Segment)
    private readonly segmentRepo: Repository<Segment>,
    private readonly chunker: ChunkerService,
    private readonly queueGen: QueueGeneratorService,
  ) {}

  async getPlaylistManifest(
    channelId: string,
    now: Date = new Date(),
  ): Promise<string> {
    const channel = await this.channelRepo.findOneBy({ id: channelId });
    if (!channel) {
      throw new Error('Channel not found');
    }

    // Initialize currentSegmentStartedAt if null (first request ever or unanchored)
    if (!channel.currentSegmentStartedAt) {
      const initialStartedAt = new Date(
        now.getTime() - (channel.playheadOffsetSeconds || 0) * 1000,
      );
      await this.channelRepo.update(
        { id: channelId, currentSegmentStartedAt: IsNull() },
        { currentSegmentStartedAt: initialStartedAt },
      );
      channel.currentSegmentStartedAt = initialStartedAt;
    }

    // 1. Fetch active segment or fallback to first segment
    let segment: Segment | null = null;
    if (channel.currentSegmentId) {
      segment = await this.segmentRepo.findOne({
        where: { id: channel.currentSegmentId },
      });
    }

    if (!segment) {
      segment = await this.segmentRepo.findOne({
        where: { channelId },
        order: { playOrder: 'ASC' },
      });
      if (segment) {
        await this.channelRepo.update(
          { id: channelId, currentSegmentId: IsNull() },
          {
            currentSegmentId: segment.id,
            currentSegmentStartedAt: now,
          },
        );
        channel.currentSegmentId = segment.id;
        channel.currentSegmentStartedAt = now;
      }
    }

    // If still no segment, buffer ahead and try again
    if (!segment) {
      this.logger.info(
        { channelId, reason: 'empty-queue' },
        'bufferAhead triggered',
      );
      await this.queueGen.bufferAhead(channelId);
      segment = await this.segmentRepo.findOne({
        where: { channelId },
        order: { playOrder: 'ASC' },
      });
      if (segment) {
        await this.channelRepo.update(
          { id: channelId, currentSegmentId: IsNull() },
          {
            currentSegmentId: segment.id,
            currentSegmentStartedAt: now,
          },
        );
        channel.currentSegmentId = segment.id;
        channel.playheadOffsetSeconds = 0;
        channel.currentSegmentStartedAt = now;
      }
    }

    if (!segment || !segment.durationSeconds) {
      this.logger.error({ channelId }, 'No segments available');
      throw new Error('No segments available');
    }

    let elapsed =
      (now.getTime() - channel.currentSegmentStartedAt.getTime()) / 1000;
    const overdue = elapsed - segment.durationSeconds;

    // 2. Idle Detection: overdue > 120s
    if (overdue > 120) {
      const expectedOld = channel.currentSegmentStartedAt;
      await this.fastForwardChannel(channelId, now);
      // Refetch updated channel state
      const updatedChannel = await this.channelRepo.findOneBy({
        id: channelId,
      });
      if (updatedChannel) {
        channel.currentSegmentId = updatedChannel.currentSegmentId;
        channel.currentSegmentStartedAt =
          updatedChannel.currentSegmentStartedAt ?? expectedOld;
      }
      if (channel.currentSegmentId) {
        segment = await this.segmentRepo.findOne({
          where: { id: channel.currentSegmentId },
        });
      }
      if (segment && channel.currentSegmentStartedAt) {
        elapsed =
          (now.getTime() - channel.currentSegmentStartedAt.getTime()) / 1000;
      }
    }

    // 3. Multi-Segment Advancement via while loop
    if (
      segment &&
      segment.durationSeconds &&
      elapsed >= segment.durationSeconds
    ) {
      const expectedOldStartedAt = channel.currentSegmentStartedAt;
      let currentStartedAt = channel.currentSegmentStartedAt;

      while (
        segment &&
        segment.durationSeconds &&
        elapsed >= segment.durationSeconds
      ) {
        elapsed -= segment.durationSeconds;
        currentStartedAt = new Date(
          currentStartedAt.getTime() + segment.durationSeconds * 1000,
        );

        const next = await this.segmentRepo.findOne({
          where: { channelId, playOrder: segment.playOrder + 1 },
        });

        if (next) {
          channel.currentSegmentId = next.id;
          segment = next;
        } else {
          // Queue exhausted
          channel.currentSegmentId = null;
          segment = null;
          break;
        }
      }

      // If exhausted, trigger bufferAhead
      if (!segment) {
        this.logger.info(
          { channelId, reason: 'empty-queue' },
          'bufferAhead triggered',
        );
        await this.queueGen.bufferAhead(channelId);
        segment = await this.segmentRepo.findOne({
          where: { channelId },
          order: { playOrder: 'ASC' },
        });
        if (segment) {
          channel.currentSegmentId = segment.id;
          currentStartedAt = now;
        }
      }

      // Optimistic conditional update on boundary transition
      if (segment) {
        await this.channelRepo.update(
          { id: channelId, currentSegmentStartedAt: expectedOldStartedAt },
          {
            currentSegmentId: segment.id,
            currentSegmentStartedAt: currentStartedAt,
          },
        );
        channel.currentSegmentStartedAt = currentStartedAt;

        // Prune segments >100 positions behind current playhead
        await this.pruneConsumed(channelId, segment.playOrder);
      }
    }

    if (!segment || !segment.durationSeconds) {
      this.logger.error({ channelId }, 'No segments available');
      throw new Error('No segments available');
    }

    // 4. Trigger Queue replenishment if remaining segments count is low (< 3)
    const remainingCount = await this.segmentRepo.count({
      where: { channelId, playOrder: MoreThan(segment.playOrder) },
    });
    if (remainingCount < 3) {
      this.logger.info(
        { channelId, reason: 'low-runway' },
        'bufferAhead triggered',
      );
      this.queueGen.bufferAhead(channelId).catch(() => {});
    }

    // 5. Build HLS sliding-window manifest with stateless monotonic sequence & cross-segment transition (#EXT-X-DISCONTINUITY)
    const createdAt = channel.createdAt ?? new Date('2026-01-01T00:00:00Z');
    const totalElapsedFromEpoch = (now.getTime() - createdAt.getTime()) / 1000;
    const mediaSequence = Math.max(0, Math.floor(totalElapsedFromEpoch / 10));

    const totalChunks = Math.ceil(segment.durationSeconds / 10);
    const currentChunkIndex = Math.min(
      Math.floor(elapsed / 10),
      totalChunks - 1,
    );

    const manifestLines = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:10',
      `#EXT-X-MEDIA-SEQUENCE:${mediaSequence}`,
      `#EXT-X-START:TIME=${(elapsed % 10).toFixed(1)}`,
    ];

    const chunkWindowSize = 3;
    let chunksAdded = 0;

    for (let i = 0; i < chunkWindowSize; i++) {
      const idx = currentChunkIndex + i;
      if (idx < totalChunks) {
        const isLastChunk = idx === totalChunks - 1;
        const chunkDuration = isLastChunk
          ? segment.durationSeconds - idx * 10
          : 10;

        manifestLines.push(`#EXTINF:${chunkDuration.toFixed(1)},`);
        manifestLines.push(this.chunker.getManifestUri(segment.id, idx));
        chunksAdded++;
      }
    }

    // Cross-Segment Window Transition: Append next segment chunks if window space remains
    if (chunksAdded < chunkWindowSize) {
      const nextSegment = await this.segmentRepo.findOne({
        where: { channelId, playOrder: segment.playOrder + 1 },
      });

      if (nextSegment && nextSegment.durationSeconds) {
        manifestLines.push('#EXT-X-DISCONTINUITY');
        const remainingNeeded = chunkWindowSize - chunksAdded;
        const nextTotalChunks = Math.ceil(nextSegment.durationSeconds / 10);

        for (let j = 0; j < remainingNeeded; j++) {
          if (j >= nextTotalChunks) break;
          const isLastChunk = j === nextTotalChunks - 1;
          const chunkDuration = isLastChunk
            ? nextSegment.durationSeconds - j * 10
            : 10;

          manifestLines.push(`#EXTINF:${chunkDuration.toFixed(1)},`);
          manifestLines.push(this.chunker.getManifestUri(nextSegment.id, j));
        }
      }
    }

    return manifestLines.join('\n') + '\n';
  }

  /**
   * Retain the last 100 played segments per channel.
   * Consumed segments older than (currentPlayOrder - 100) are purged
   * from PostgreSQL and their 10s MP3 chunks are deleted from MinIO S3.
   */
  private async pruneConsumed(
    channelId: string,
    currentPlayOrder: number,
  ): Promise<void> {
    const cutoffPlayOrder = currentPlayOrder - 100;
    if (cutoffPlayOrder <= 0) return;

    // 1. Fetch expired segments to delete CDN chunks from MinIO S3
    const expiredSegments = await this.segmentRepo.find({
      where: {
        channelId,
        playOrder: LessThan(cutoffPlayOrder),
      },
    });

    for (const seg of expiredSegments) {
      if (seg.durationSeconds) {
        await this.chunker.deleteSegmentChunks(
          channelId,
          seg.id,
          seg.durationSeconds,
        );
      }
    }

    // 2. Delete expired segment rows from DB
    await this.segmentRepo.delete({
      channelId,
      playOrder: LessThan(cutoffPlayOrder),
    });
  }

  async fastForwardChannel(channelId: string, now: Date): Promise<void> {
    const channel = await this.channelRepo.findOneBy({ id: channelId });
    if (!channel || !channel.currentSegmentId) return;

    const segment = await this.segmentRepo.findOne({
      where: { id: channel.currentSegmentId },
    });
    if (!segment || !segment.durationSeconds) return;

    const expectedOldStartedAt = channel.currentSegmentStartedAt ?? IsNull();

    if (segment.durationSeconds > 20) {
      const wrapDuration = Math.floor(Math.random() * 11) + 10; // 10 to 20s
      const newStartedAt = new Date(
        now.getTime() - (segment.durationSeconds - wrapDuration) * 1000,
      );

      await this.channelRepo.update(
        { id: channelId, currentSegmentStartedAt: expectedOldStartedAt },
        {
          currentSegmentId: segment.id,
          currentSegmentStartedAt: newStartedAt,
        },
      );
    } else {
      const next = await this.segmentRepo.findOne({
        where: { channelId, playOrder: segment.playOrder + 1 },
      });

      if (next) {
        await this.channelRepo.update(
          { id: channelId, currentSegmentStartedAt: expectedOldStartedAt },
          {
            currentSegmentId: next.id,
            currentSegmentStartedAt: now,
          },
        );
        await this.pruneConsumed(channelId, next.playOrder);
      }
    }
  }
}
