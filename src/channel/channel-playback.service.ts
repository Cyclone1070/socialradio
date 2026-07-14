import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { Channel } from './entities/channel.entity';
import { Segment } from './entities/segment.entity';
import { ChunkerService } from './chunker.service';
import { QueueGeneratorService } from './queue-generator.service';

@Injectable()
export class ChannelPlaybackService {
  constructor(
    @InjectRepository(Channel)
    private readonly channelRepo: Repository<Channel>,
    @InjectRepository(Segment)
    private readonly segmentRepo: Repository<Segment>,
    private readonly chunker: ChunkerService,
    private readonly queueGen: QueueGeneratorService,
  ) {}

  async getPlaylistManifest(channelId: string): Promise<string> {
    const channel = await this.channelRepo.findOneBy({ id: channelId });
    if (!channel) {
      throw new Error('Channel not found');
    }

    const now = new Date();

    // 1. If this is a resume/wake-up request (idle >= 120s):
    if (channel.lastRequestedAt) {
      const idleTimeSeconds =
        (now.getTime() - channel.lastRequestedAt.getTime()) / 1000;
      if (idleTimeSeconds >= 120) {
        await this.fastForwardChannel(channel.id, idleTimeSeconds);
      } else {
        // Active poll: advance playhead by the elapsed duration since last request
        channel.playheadOffsetSeconds += idleTimeSeconds;
      }
    } else {
      // First request ever: initialize lastRequestedAt and playheadOffsetSeconds
      channel.playheadOffsetSeconds = 0;
    }

    channel.lastRequestedAt = now;

    // 2. Fetch current segment or fallback to first segment
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
        channel.currentSegmentId = segment.id;
        channel.playheadOffsetSeconds = 0;
      }
    }

    // If there is still no segment, buffer ahead and fetch again
    if (!segment) {
      await this.queueGen.bufferAhead(channelId);
      segment = await this.segmentRepo.findOne({
        where: { channelId },
        order: { playOrder: 'ASC' },
      });
      if (segment) {
        channel.currentSegmentId = segment.id;
        channel.playheadOffsetSeconds = 0;
      }
    }

    // 3. Advance to the next segment if we've played past the current one
    if (
      segment &&
      segment.durationSeconds &&
      channel.playheadOffsetSeconds >= segment.durationSeconds
    ) {
      while (
        segment &&
        segment.durationSeconds &&
        channel.playheadOffsetSeconds >= segment.durationSeconds
      ) {
        channel.playheadOffsetSeconds -= segment.durationSeconds;
        const next = await this.segmentRepo.findOne({
          where: { channelId, playOrder: segment.playOrder + 1 },
        });
        if (next) {
          channel.currentSegmentId = next.id;
          segment = next;
        } else {
          // End of queue reached: clear current segment and trigger bufferAhead
          channel.currentSegmentId = null;
          segment = null;
          break;
        }
      }

      // If we ran out of segments, buffer ahead in the background and try to fetch
      if (!segment) {
        await this.queueGen.bufferAhead(channelId);
        segment = await this.segmentRepo.findOne({
          where: { channelId },
          order: { playOrder: 'ASC' },
        });
        if (segment) {
          channel.currentSegmentId = segment.id;
        }
      }
    }

    await this.channelRepo.save(channel);

    if (!segment || !segment.durationSeconds) {
      throw new Error('No segments available');
    }

    // 4. Trigger Queue replenishment if remaining segments count is low (< 3)
    const remainingCount = await this.segmentRepo.count({
      where: { channelId, playOrder: MoreThan(segment.playOrder) },
    });
    if (remainingCount < 3) {
      this.queueGen.bufferAhead(channelId).catch(() => {});
    }

    // 5. Build HLS sliding-window manifest pointing to pre-chunked chunk files
    const totalChunks = Math.ceil(segment.durationSeconds / 10);
    const currentChunkIndex = Math.min(
      Math.floor(channel.playheadOffsetSeconds / 10),
      totalChunks - 1,
    );

    const mediaSequence = currentChunkIndex + 1; // standard positive sequence index
    const manifestLines = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:10',
      `#EXT-X-MEDIA-SEQUENCE:${mediaSequence}`,
      `#EXT-X-START:TIME=${(channel.playheadOffsetSeconds % 10).toFixed(1)}`,
    ];

    // Show up to 3 chunks starting from currentChunkIndex (or fewer if segment is ending)
    const chunkWindowSize = 3;
    for (let i = 0; i < chunkWindowSize; i++) {
      const idx = currentChunkIndex + i;
      if (idx >= totalChunks) break;

      const isLastChunk = idx === totalChunks - 1;
      const chunkDuration = isLastChunk
        ? segment.durationSeconds - idx * 10
        : 10;

      manifestLines.push(`#EXTINF:${chunkDuration.toFixed(1)},`);
      manifestLines.push(this.chunker.getManifestUri(segment.id, idx));
    }

    return manifestLines.join('\n') + '\n';
  }

  async fastForwardChannel(channelId: string, seconds: number): Promise<void> {
    const channel = await this.channelRepo.findOneBy({ id: channelId });
    if (!channel || !channel.currentSegmentId) return;

    const segment = await this.segmentRepo.findOne({
      where: { id: channel.currentSegmentId },
    });
    if (!segment || !segment.durationSeconds) return;

    const remainingInSegment =
      segment.durationSeconds - channel.playheadOffsetSeconds;
    if (seconds < remainingInSegment) {
      // Idle time is short: resume exactly where they left off (offset unchanged)
    } else {
      // Idle time is long: skip to a randomized wrap-up duration between 10s and 20s
      if (segment.durationSeconds > 20) {
        const wrapDuration = Math.floor(Math.random() * 11) + 10; // 10 to 20 seconds inclusive
        channel.playheadOffsetSeconds = segment.durationSeconds - wrapDuration;
      } else {
        // Short segment: skip entirely and transition to the next segment
        const next = await this.segmentRepo.findOne({
          where: { channelId, playOrder: segment.playOrder + 1 },
        });
        if (next) {
          channel.currentSegmentId = next.id;
          channel.playheadOffsetSeconds = 0;
        } else {
          channel.currentSegmentId = null;
          channel.playheadOffsetSeconds = 0;
        }
      }
    }

    await this.channelRepo.save(channel);
  }
}
