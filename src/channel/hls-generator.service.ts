import { Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Channel } from './entities/channel.entity';
import { Segment } from './entities/segment.entity';
import type { StorageService } from '../domain/types/storage.interface';

@Injectable()
export class HlsGeneratorService {
  constructor(
    @InjectRepository(Channel)
    private readonly channelRepo: Repository<Channel>,
    @InjectRepository(Segment)
    private readonly segmentRepo: Repository<Segment>,
    @Inject('StorageService')
    private readonly storageService: StorageService,
  ) {}

  async sliceAndUpload(
    channelId: string,
    segmentId: string,
    sourceFilePath: string,
  ): Promise<number> {
    const fileBuffer = await this.storageService.read(sourceFilePath);
    const chunkSize = 160000; // 10s chunks at 128kbps CBR MP3 (16,000 bytes/sec)
    let index = 0;

    for (let offset = 0; offset < fileBuffer.length; offset += chunkSize) {
      const end = Math.min(offset + chunkSize, fileBuffer.length);
      const chunkBuffer = fileBuffer.subarray(offset, end);
      const chunkPath = `channels/${channelId}/chunks/${segmentId}_${index}.mp3`;

      await this.storageService.write({
        key: chunkPath,
        content: chunkBuffer,
        contentType: 'audio/mpeg',
        cacheControl: 'public, max-age=31536000, immutable',
      });
      index++;
    }

    return index;
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
      // Idle time is long: skip to the last 10s of the current segment
      if (segment.durationSeconds > 10) {
        channel.playheadOffsetSeconds = segment.durationSeconds - 10;
      } else {
        channel.playheadOffsetSeconds = 0;
      }
    }

    await this.channelRepo.save(channel);
  }
}
