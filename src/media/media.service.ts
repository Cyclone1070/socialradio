import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';
import { MusicTrack } from './entities/music-track.entity';
import { Jingle } from './entities/jingle.entity';
import { BreakLiner } from './entities/break-liner.entity';
import {
  MusicTrackSchema,
  JingleSchema,
  BreakLinerSchema,
} from '../infrastructure/database/schemas/media.schema';
import { MusicData, JingleData, BreakLinerData } from './types/audio.types';
import { MediaContract } from './media.contract';
import { createServiceLogger } from '../infrastructure/logging/logging.module';
import { StorageService } from '../infrastructure/storage/storage.service';

@Injectable()
export class MediaService implements MediaContract {
  private readonly logger = createServiceLogger(MediaService.name);

  /**
   * Whether the bucket holds the audio for a key, remembered for the life of the
   * process. A row can outlive its audio - an object deleted from the bucket
   * leaves a row that looks healthy until a listener reaches the break it
   * belongs to - so every key in a pool is checked before it can be drawn.
   * The database only changes at deploy time, and a deploy restarts this
   * process, so the verdicts cannot go stale in a way that matters.
   */
  private readonly audioPresent = new Map<string, boolean>();

  constructor(
    @InjectRepository(MusicTrackSchema)
    private readonly musicRepo: EntityRepository<MusicTrack>,
    @InjectRepository(JingleSchema)
    private readonly jingleRepo: EntityRepository<Jingle>,
    @InjectRepository(BreakLinerSchema)
    private readonly breakLinerRepo: EntityRepository<BreakLiner>,
    private readonly storageService: StorageService,
  ) {}

  async getRandomMusic(): Promise<MusicData> {
    const track = await this.draw(
      'music',
      await this.musicRepo.findAll(),
      (row) => row.filePath,
    );
    return {
      title: track.title,
      artist: track.artist,
      filePath: track.filePath,
      durationSeconds: track.durationSeconds,
    };
  }

  async getRandomBreakLiner(): Promise<BreakLinerData> {
    const breakLiner = await this.draw(
      'break_liner',
      await this.breakLinerRepo.findAll(),
      (row) => row.filePath,
    );
    return {
      filePath: breakLiner.filePath,
      durationSeconds: breakLiner.durationSeconds,
      text: breakLiner.text,
    };
  }

  async getRandomJingle(): Promise<JingleData> {
    const jingle = await this.draw(
      'jingle',
      await this.jingleRepo.findAll(),
      (row) => row.filePath,
    );
    return {
      filePath: jingle.filePath,
      durationSeconds: jingle.durationSeconds,
      name: jingle.name,
    };
  }

  /** One row at random from the pool, counting only rows the bucket can serve. */
  private async draw<T>(
    type: string,
    rows: T[],
    keyOf: (row: T) => string,
  ): Promise<T> {
    if (rows.length === 0) {
      this.logger.warn({ type }, 'media pool empty');
      throw new NotFoundException(`No ${type} found`);
    }

    const servable: T[] = [];
    let absent = 0;
    for (const row of rows) {
      const key = keyOf(row);
      let present = this.audioPresent.get(key);
      if (present === undefined) {
        present = await this.storageService.exists(key);
        this.audioPresent.set(key, present);
      }
      if (present) servable.push(row);
      else absent += 1;
    }

    if (absent > 0) {
      this.logger.warn(
        { type, absent },
        'rows in the pool have no audio in the bucket, leaving them out',
      );
    }
    if (servable.length === 0) {
      this.logger.warn({ type }, 'media pool empty');
      throw new NotFoundException(`No ${type} found`);
    }

    return servable[Math.floor(Math.random() * servable.length)];
  }
}
