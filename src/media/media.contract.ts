import { MusicData, BreakLinerData, JingleData } from './types/audio.types';

/**
 * Draw one clip from each pool. The caller never names a file: which song or
 * which line airs is decided here, from the rows in the database.
 */
export abstract class MediaContract {
  abstract getRandomMusic(): Promise<MusicData>;
  abstract getRandomBreakLiner(): Promise<BreakLinerData>;
  abstract getRandomJingle(): Promise<JingleData>;
}
