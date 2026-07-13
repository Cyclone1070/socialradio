import {
  Injectable,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Channel } from './entities/channel.entity';
import { HlsGeneratorService } from './hls-generator.service';
import type { StorageService } from '../domain/types/storage.interface';

@Injectable()
export class ChannelBroadcasterService
  implements OnModuleInit, OnModuleDestroy
{
  private tickerInterval: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(Channel)
    private readonly channelRepo: Repository<Channel>,
    private readonly hlsGen: HlsGeneratorService,
    @Inject('StorageService')
    private readonly storageService: StorageService,
  ) {}

  onModuleInit() {
    this.tickerInterval = setInterval(() => {
      void this.tickActiveChannels();
    }, 10000);
  }

  onModuleDestroy() {
    if (this.tickerInterval) {
      clearInterval(this.tickerInterval);
    }
  }

  async tickActiveChannels(): Promise<void> {
    const channels = await this.channelRepo.find();
    const now = Date.now();
    for (const channel of channels) {
      const isActive =
        channel.visibility === 'public' ||
        (channel.lastRequestedAt &&
          now - channel.lastRequestedAt.getTime() < 25000);

      if (isActive && !channel.isPaused) {
        await this.hlsGen.generateNextChunk(channel.id);
      } else if (!isActive && !channel.isPaused) {
        channel.isPaused = true;
        await this.channelRepo.save(channel);
      }
    }
  }

  async getPlaylistManifest(channelId: string): Promise<string> {
    const channel = await this.channelRepo.findOneBy({ id: channelId });
    if (!channel) {
      throw new Error('Channel not found');
    }

    const now = new Date();
    if (channel.visibility === 'private') {
      if (channel.isPaused) {
        const elapsedMs = channel.lastRequestedAt
          ? now.getTime() - channel.lastRequestedAt.getTime()
          : 0;
        const elapsedSeconds = Math.floor(elapsedMs / 1000);
        if (elapsedSeconds > 0) {
          await this.hlsGen.fastForwardChannel(channelId, elapsedSeconds);
        }
        channel.isPaused = false;
      }
      channel.lastRequestedAt = now;
      await this.channelRepo.save(channel);
    } else {
      channel.lastRequestedAt = now;
      await this.channelRepo.save(channel);
    }

    const manifestPath = `channels/${channelId}/playlist.m3u8`;
    let exists = this.storageService.exists(manifestPath);
    if (!exists) {
      // Seed manifest
      await this.hlsGen.generateNextChunk(channelId);
      exists = this.storageService.exists(manifestPath);
    }

    if (!exists) {
      throw new Error('Playlist manifest not ready');
    }

    const buffer = await this.storageService.read(manifestPath);
    return buffer.toString('utf-8');
  }
}
