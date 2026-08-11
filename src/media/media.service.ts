import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MusicTrack } from './entities/music-track.entity';
import { AdTrack } from './entities/ad-track.entity';
import { Jingle } from './entities/jingle.entity';
import {
  SongRef,
  AdRef,
  JingleRef,
} from '../domain/types/audio-file-ref.interface';
import { createServiceLogger } from '../logging/logging.module';

@Injectable()
export class MediaService {
  private readonly logger = createServiceLogger(MediaService.name);

  constructor(
    @InjectRepository(MusicTrack)
    private readonly musicRepo: Repository<MusicTrack>,
    @InjectRepository(AdTrack)
    private readonly adRepo: Repository<AdTrack>,
    @InjectRepository(Jingle)
    private readonly jingleRepo: Repository<Jingle>,
  ) {}

  async getRandomMusic(): Promise<SongRef> {
    const tracks = await this.musicRepo.find();
    if (tracks.length === 0) {
      this.logger.warn({ type: 'music' }, 'media pool empty');
      throw new NotFoundException('No music tracks found');
    }
    const track = tracks[Math.floor(Math.random() * tracks.length)];
    return {
      filePath: track.filePath,
      durationSeconds: track.durationSeconds,
      title: track.title,
      artist: track.artist,
    };
  }

  async getRandomAd(): Promise<AdRef> {
    const ads = await this.adRepo.find();
    if (ads.length === 0) {
      this.logger.warn({ type: 'ad' }, 'media pool empty');
      throw new NotFoundException('No ads found');
    }
    const ad = ads[Math.floor(Math.random() * ads.length)];
    return {
      filePath: ad.filePath,
      durationSeconds: ad.durationSeconds,
      advertiser: ad.advertiser,
    };
  }

  async getRandomJingle(): Promise<JingleRef> {
    const jingles = await this.jingleRepo.find();
    if (jingles.length === 0) {
      this.logger.warn({ type: 'jingle' }, 'media pool empty');
      throw new NotFoundException('No jingles found');
    }
    const jingle = jingles[Math.floor(Math.random() * jingles.length)];
    return {
      filePath: jingle.filePath,
      durationSeconds: jingle.durationSeconds,
      name: jingle.name,
    };
  }
}
