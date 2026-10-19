import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';
import { MusicTrack } from './entities/music-track.entity';
import { Jingle } from './entities/jingle.entity';
import { Liner } from './entities/liner.entity';
import {
  MusicTrackSchema,
  JingleSchema,
  LinerSchema,
} from '../infrastructure/database/schemas/media.schema';
import { MusicData, JingleData, LinerData, MediaContract } from '../domain';
import { createServiceLogger } from '../infrastructure/logging/logging.module';

@Injectable()
export class MediaService implements MediaContract {
  private readonly logger = createServiceLogger(MediaService.name);

  constructor(
    @InjectRepository(MusicTrackSchema)
    private readonly musicRepo: EntityRepository<MusicTrack>,
    @InjectRepository(JingleSchema)
    private readonly jingleRepo: EntityRepository<Jingle>,
    @InjectRepository(LinerSchema)
    private readonly linerRepo: EntityRepository<Liner>,
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

  async getRandomLiner(): Promise<LinerData> {
    const liners = await this.linerRepo.findAll();
    if (liners.length === 0) {
      this.logger.warn({ type: 'liner' }, 'media pool empty');
      throw new NotFoundException('No liners found');
    }
    const liner = liners[Math.floor(Math.random() * liners.length)];
    return {
      filePath: liner.filePath,
      durationSeconds: liner.durationSeconds,
      text: liner.text,
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
