import { Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Channel } from './entities/channel.entity';
import { Segment, TalkSegment, AdSegment } from './entities/segment.entity';
import { QueueGeneratorService } from './queue-generator.service';
import type { StorageService } from '../domain/types/storage.interface';
import { MediaService } from '../media/media.service';
import { Response } from 'express';
import { ReadStream } from 'fs';

export class ChannelBroadcaster {
  private clients: Response[] = [];
  private isStreaming = false;
  private currentStream: ReadStream | null = null;
  private elapsedSeconds = 0;

  constructor(
    private readonly channelId: string,
    private readonly channelRepo: Repository<Channel>,
    private readonly segmentRepo: Repository<Segment>,
    private readonly queueGen: QueueGeneratorService,
    private readonly mediaService: MediaService,
    private readonly storageService: StorageService,
  ) {}

  async addClient(res: Response) {
    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      Connection: 'keep-alive',
      'Transfer-Encoding': 'chunked',
    });

    this.clients.push(res);

    res.on('close', () => {
      this.clients = this.clients.filter((c) => c !== res);
      if (this.clients.length === 0) {
        void this.pauseTransmission();
      }
    });

    if (!this.isStreaming) {
      await this.startTransmission();
    }
  }

  private async startTransmission() {
    this.isStreaming = true;
    const channel = await this.channelRepo.findOneBy({ id: this.channelId });
    if (!channel) return;

    channel.isPaused = false;
    await this.channelRepo.save(channel);

    this.elapsedSeconds = channel.pausedOffsetSeconds;
    channel.pausedOffsetSeconds = 0; // reset
    await this.channelRepo.save(channel);

    // Run async loop
    this.transmissionLoop().catch(() => {
      this.isStreaming = false;
    });
  }

  private async pauseTransmission() {
    this.isStreaming = false;
    if (this.currentStream) {
      this.currentStream.destroy();
      this.currentStream = null;
    }

    const channel = await this.channelRepo.findOneBy({ id: this.channelId });
    if (channel) {
      channel.isPaused = true;
      channel.pausedOffsetSeconds = this.elapsedSeconds;
      await this.channelRepo.save(channel);
    }
  }

  private broadcast(chunk: Buffer) {
    this.clients.forEach((client) => {
      try {
        client.write(chunk);
      } catch {
        // Client might have disconnected silently
      }
    });
  }

  private async transmissionLoop(): Promise<void> {
    if (!this.isStreaming) return;

    const channel = await this.channelRepo.findOneBy({ id: this.channelId });
    if (!channel) return;

    let item: Segment | null = null;
    if (channel.currentSegmentId) {
      item = await this.segmentRepo.findOne({
        where: { id: channel.currentSegmentId },
      });
    }

    if (!item) {
      // Find first item in sequence
      item = await this.segmentRepo.findOne({
        where: { channelId: this.channelId },
        order: { playOrder: 'ASC' },
      });
    }

    if (!item) {
      // Queue is empty, seed it
      await this.queueGen.bufferAhead(this.channelId);
      item = await this.segmentRepo.findOne({
        where: { channelId: this.channelId },
        order: { playOrder: 'ASC' },
      });
    }

    if (!item) {
      // Double check fail: fallback to song break
      const fallback = await this.mediaService.getRandomAd();
      const fallbackItem = Object.assign(new AdSegment(), {
        channelId: this.channelId,
        playOrder: 1,
        audioUrl: fallback.filePath,
        durationSeconds: fallback.durationSeconds,
      });
      item = await this.segmentRepo.save(fallbackItem);
    }

    channel.currentSegmentId = item.id;
    await this.channelRepo.save(channel);

    if (item instanceof TalkSegment && item.status === 'generating') {
      // Dynamic Ad/Song Break Fallback: Inject a 30s ad ahead
      const breakSegment = await this.mediaService.getRandomAd();
      const breakItem = Object.assign(new AdSegment(), {
        channelId: this.channelId,
        playOrder: item.playOrder,
        audioUrl: breakSegment.filePath,
        durationSeconds: breakSegment.durationSeconds,
      });

      // Shift subsequence playOrders up by 1
      const subItems = await this.segmentRepo.find({
        where: { channelId: this.channelId },
      });
      for (const sub of subItems) {
        if (sub.playOrder >= item.playOrder) {
          sub.playOrder += 1;
          await this.segmentRepo.save(sub);
        }
      }

      const savedBreakItem = await this.segmentRepo.save(breakItem);
      channel.currentSegmentId = savedBreakItem.id;
      await this.channelRepo.save(channel);
      item = savedBreakItem;
    }

    if (item instanceof TalkSegment && item.status === 'failed') {
      // Skip failed talk segments
      const nextItem = await this.segmentRepo.findOne({
        where: {
          channelId: this.channelId,
          playOrder: item.playOrder + 1,
        },
      });
      if (nextItem) {
        channel.currentSegmentId = nextItem.id;
        await this.channelRepo.save(channel);
      }
      return this.transmissionLoop();
    }

    if (!item.audioUrl) {
      return;
    }

    const startOffset = Math.floor(this.elapsedSeconds * 16000);
    this.currentStream = this.storageService.createReadStream(item.audioUrl, {
      start: startOffset,
    });

    const playPromise = new Promise<void>((resolve, reject) => {
      if (!this.currentStream) {
        resolve();
        return;
      }
      this.currentStream.on('data', (chunk: Buffer) => {
        void (async () => {
          if (this.currentStream) {
            this.currentStream.pause();
          }
          const duration = chunk.length / 16000;
          const delayMs = duration * 1000;
          await new Promise((r) => setTimeout(r, delayMs));
          this.broadcast(chunk);
          this.elapsedSeconds += duration;
          if (this.currentStream) {
            this.currentStream.resume();
          }
        })();
      });

      if (this.currentStream) {
        this.currentStream.on('end', () => {
          resolve();
        });

        this.currentStream.on('error', (err: Error) => {
          reject(err);
        });
      }
    });

    try {
      await playPromise;
    } catch {
      // Handle stream reading error
    }

    this.currentStream = null;

    // Transition to next item
    const nextItem = await this.segmentRepo.findOne({
      where: {
        channelId: this.channelId,
        playOrder: item.playOrder + 1,
      },
    });

    if (nextItem) {
      channel.currentSegmentId = nextItem.id;
      this.elapsedSeconds = 0;
      await this.channelRepo.save(channel);
    } else {
      channel.currentSegmentId = null;
      this.elapsedSeconds = 0;
      await this.channelRepo.save(channel);
    }

    // Async buffer ahead
    this.queueGen.bufferAhead(this.channelId).catch(() => {});

    // Recurse
    return this.transmissionLoop();
  }
}

@Injectable()
export class ChannelBroadcasterService {
  private broadcasters: Map<string, ChannelBroadcaster> = new Map();

  constructor(
    @InjectRepository(Channel)
    private readonly channelRepo: Repository<Channel>,
    @InjectRepository(Segment)
    private readonly segmentRepo: Repository<Segment>,
    private readonly queueGen: QueueGeneratorService,
    private readonly mediaService: MediaService,
    @Inject('StorageService')
    private readonly storageService: StorageService,
  ) {}

  private getBroadcaster(channelId: string): ChannelBroadcaster {
    let broadcaster = this.broadcasters.get(channelId);
    if (!broadcaster) {
      broadcaster = new ChannelBroadcaster(
        channelId,
        this.channelRepo,
        this.segmentRepo,
        this.queueGen,
        this.mediaService,
        this.storageService,
      );
      this.broadcasters.set(channelId, broadcaster);
    }
    return broadcaster;
  }

  async registerClient(channelId: string, res: Response) {
    const broadcaster = this.getBroadcaster(channelId);
    await broadcaster.addClient(res);
  }
}
