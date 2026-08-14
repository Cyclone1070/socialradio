import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MusicTrack } from './entities/music-track.entity';
import { AdTrack as AdTrackEntity } from './entities/ad-track.entity';
import { Jingle } from './entities/jingle.entity';
import { SongData, AdData, JingleData } from '../domain';
import { createServiceLogger } from '../infrastructure/logging/logging.module';

@Injectable()
export class MediaService {
  private readonly logger = createServiceLogger(MediaService.name);

  constructor(
    @InjectRepository(MusicTrack)
    private readonly musicRepo: Repository<MusicTrack>,
    @InjectRepository(AdTrackEntity)
    private readonly adRepo: Repository<AdTrackEntity>,
    @InjectRepository(Jingle)
    private readonly jingleRepo: Repository<Jingle>,
  ) {}

  async getRandomMusic(): Promise<SongData> {
    const tracks = await this.musicRepo.find();
    if (tracks.length === 0) {
      this.logger.warn({ type: 'music' }, 'media pool empty');
      throw new NotFoundException('No music tracks found');
    }
    const track = tracks[Math.floor(Math.random() * tracks.length)];
    return {
      title: track.title,
      artist: track.artist,
      filePath: track.filePath,
      durationSeconds: track.durationSeconds,
    };
  }

  async getRandomAd(): Promise<AdData> {
    const ads = await this.adRepo.find();
    if (ads.length === 0) {
      this.logger.warn({ type: 'ad' }, 'media pool empty');
      throw new NotFoundException('No ad tracks found');
    }
    const ad = ads[Math.floor(Math.random() * ads.length)];
    return {
      advertiser: ad.advertiser,
      filePath: ad.filePath,
      durationSeconds: ad.durationSeconds,
    };
  }

  async getRandomJingle(): Promise<JingleData> {
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
