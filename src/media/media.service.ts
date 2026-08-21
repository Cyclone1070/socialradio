import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';
import { MusicTrack } from './entities/music-track.entity';
import { AdTrack as AdTrackEntity } from './entities/ad-track.entity';
import { Jingle } from './entities/jingle.entity';
import {
  MusicTrackSchema,
  AdTrackSchema,
  JingleSchema,
} from '../infrastructure/database/schemas/media.schema';
import { MusicData, AdData, JingleData, MediaContract } from '../domain';
import { createServiceLogger } from '../infrastructure/logging/logging.module';

@Injectable()
export class MediaService implements MediaContract {
  private readonly logger = createServiceLogger(MediaService.name);

  constructor(
    @InjectRepository(MusicTrackSchema)
    private readonly musicRepo: EntityRepository<MusicTrack>,
    @InjectRepository(AdTrackSchema)
    private readonly adRepo: EntityRepository<AdTrackEntity>,
    @InjectRepository(JingleSchema)
    private readonly jingleRepo: EntityRepository<Jingle>,
  ) {}

  async getRandomMusic(): Promise<MusicData> {
    const tracks = await this.musicRepo.findAll();
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
    const ads = await this.adRepo.findAll();
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
    const jingles = await this.jingleRepo.findAll();
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
