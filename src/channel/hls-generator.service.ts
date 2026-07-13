import { Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Channel } from './entities/channel.entity';
import { Segment, TalkSegment, AdSegment } from './entities/segment.entity';
import { QueueGeneratorService } from './queue-generator.service';
import type { StorageService } from '../domain/types/storage.interface';
import { Readable } from 'stream';

@Injectable()
export class HlsGeneratorService {
  constructor(
    @InjectRepository(Channel)
    private readonly channelRepo: Repository<Channel>,
    @InjectRepository(Segment)
    private readonly segmentRepo: Repository<Segment>,
    @Inject('StorageService')
    private readonly storageService: StorageService,
    private readonly queueGen: QueueGeneratorService,
  ) {}

  async generateNextChunk(channelId: string): Promise<void> {
    const channel = await this.channelRepo.findOneBy({ id: channelId });
    if (!channel) return;

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
      if (!segment) {
        await this.queueGen.bufferAhead(channelId);
        segment = await this.segmentRepo.findOne({
          where: { channelId },
          order: { playOrder: 'ASC' },
        });
      }
      if (segment) {
        channel.currentSegmentId = segment.id;
        channel.playheadOffsetSeconds = 0;
        await this.channelRepo.save(channel);
      }
    }

    if (!segment) return;

    // Handle background generation and fallback states
    if (segment instanceof TalkSegment && segment.status === 'generating') {
      const fallback = await this.injectFallbackAd(
        channelId,
        segment.playOrder,
      );
      channel.currentSegmentId = fallback.id;
      channel.playheadOffsetSeconds = 0;
      await this.channelRepo.save(channel);
      segment = fallback;
    }

    if (segment instanceof TalkSegment && segment.status === 'failed') {
      const nextSegment = await this.segmentRepo.findOne({
        where: { channelId, playOrder: segment.playOrder + 1 },
      });
      if (nextSegment) {
        channel.currentSegmentId = nextSegment.id;
        channel.playheadOffsetSeconds = 0;
        await this.channelRepo.save(channel);
        return this.generateNextChunk(channelId);
      }
      return;
    }

    if (!segment.audioUrl || !segment.durationSeconds) {
      return;
    }

    const currentOffset = channel.playheadOffsetSeconds;
    const remainingTime = segment.durationSeconds - currentOffset;
    let sliceDuration = 10;
    let transitionToNext = false;

    if (remainingTime <= 10) {
      sliceDuration = remainingTime;
      transitionToNext = true;
    }

    const startByte = Math.floor(currentOffset * 16000);
    const endByte = Math.floor((currentOffset + sliceDuration) * 16000) - 1;

    let chunkBuffer: Buffer;
    try {
      const stream = this.storageService.createReadStream(segment.audioUrl, {
        start: startByte,
        end: endByte,
      });
      chunkBuffer = await this.streamToBuffer(stream);
    } catch {
      // Create empty buffer on stream reading error
      chunkBuffer = Buffer.alloc(Math.floor(sliceDuration * 16000));
    }

    const chunkName = `chunk_${channelId}_${Date.now()}.mp3`;
    const chunkPath = `channels/${channelId}/chunks/${chunkName}`;

    await this.storageService.write({
      key: chunkPath,
      content: chunkBuffer,
      contentType: 'audio/mpeg',
      cacheControl: 'public, max-age=31536000, immutable',
    });

    if (transitionToNext) {
      const nextSegment = await this.segmentRepo.findOne({
        where: { channelId, playOrder: segment.playOrder + 1 },
      });
      if (nextSegment) {
        channel.currentSegmentId = nextSegment.id;
        channel.playheadOffsetSeconds = 0;
      } else {
        channel.currentSegmentId = null;
        channel.playheadOffsetSeconds = 0;
        // Asynchronously buffer ahead when queue is exhausted
        this.queueGen.bufferAhead(channelId).catch(() => {});
      }
    } else {
      channel.playheadOffsetSeconds += sliceDuration;
    }

    await this.channelRepo.save(channel);
    await this.updatePlaylistManifest(channelId, chunkName, sliceDuration);
  }

  async fastForwardChannel(channelId: string, seconds: number): Promise<void> {
    const channel = await this.channelRepo.findOneBy({ id: channelId });
    if (!channel) return;

    if (!channel.currentSegmentId) {
      return;
    }

    const segment = await this.segmentRepo.findOne({
      where: { id: channel.currentSegmentId },
    });
    if (!segment || !segment.durationSeconds) {
      return;
    }

    const remainingInSegment =
      segment.durationSeconds - channel.playheadOffsetSeconds;
    if (seconds < remainingInSegment) {
      // Idle time is short: resume exactly where they left off
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

  private async injectFallbackAd(
    channelId: string,
    playOrder: number,
  ): Promise<Segment> {
    // Select a random fallback ad segment structure
    const fallbackAd = Object.assign(new AdSegment(), {
      channelId,
      playOrder,
      audioUrl: 'assets/ads/default.mp3', // default ad fallback path
      durationSeconds: 30,
    });

    const subSegments = await this.segmentRepo.find({ where: { channelId } });
    for (const sub of subSegments) {
      if (sub.playOrder >= playOrder) {
        sub.playOrder += 1;
        await this.segmentRepo.save(sub);
      }
    }

    return this.segmentRepo.save(fallbackAd);
  }

  private async updatePlaylistManifest(
    channelId: string,
    newChunkName: string,
    duration: number,
  ): Promise<void> {
    const manifestPath = `channels/${channelId}/playlist.m3u8`;
    let manifestContent = '';
    let mediaSequence = 1;
    const chunkLines: { duration: number; url: string }[] = [];

    const exists = this.storageService.exists(manifestPath);
    if (exists) {
      try {
        const buffer = await this.storageService.read(manifestPath);
        manifestContent = buffer.toString('utf-8');
        const lines = manifestContent.split('\n');

        const seqMatch = manifestContent.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/);
        if (seqMatch) {
          mediaSequence = parseInt(seqMatch[1], 10);
        }

        let currentDuration = 10;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.startsWith('#EXTINF:')) {
            currentDuration = parseFloat(line.split(':')[1]);
          } else if (line && !line.startsWith('#')) {
            chunkLines.push({ duration: currentDuration, url: line });
          }
        }
      } catch {
        // Fallback to empty manifest if read fails
      }
    }

    // Add new chunk path (relative path to chunks subdirectory)
    chunkLines.push({ duration, url: `chunks/${newChunkName}` });

    // Enforce sliding window of latest 3 chunks
    if (chunkLines.length > 3) {
      const removed = chunkLines.shift();
      mediaSequence += 1;
      if (removed) {
        const oldChunkPath = `channels/${channelId}/${removed.url}`;
        if (this.storageService.exists(oldChunkPath)) {
          this.storageService.delete(oldChunkPath).catch(() => {});
        }
      }
    }

    // Generate manifest lines
    const outputLines = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:10',
      `#EXT-X-MEDIA-SEQUENCE:${mediaSequence}`,
    ];

    for (const chunk of chunkLines) {
      outputLines.push(`#EXTINF:${chunk.duration.toFixed(1)},`);
      outputLines.push(chunk.url);
    }
    outputLines.push(''); // Final trailing newline

    const updatedManifest = outputLines.join('\n');
    await this.storageService.write({
      key: manifestPath,
      content: updatedManifest,
      contentType: 'application/vnd.apple.mpegurl',
      cacheControl: 'no-store, no-cache, must-revalidate',
    });
  }

  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      const typedChunk = chunk as unknown as Buffer | string;
      chunks.push(
        typeof typedChunk === 'string' ? Buffer.from(typedChunk) : typedChunk,
      );
    }
    return Buffer.concat(chunks);
  }
}
