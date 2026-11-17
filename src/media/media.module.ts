import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import {
  MusicTrackSchema,
  JingleSchema,
  BreakLinerSchema,
} from '../infrastructure/database/schemas/media.schema';
import { MediaService } from './media.service';
import { MediaContract } from './media.contract';
import { StorageModule } from '../infrastructure/storage/storage.module';

@Module({
  imports: [
    MikroOrmModule.forFeature([
      MusicTrackSchema,
      JingleSchema,
      BreakLinerSchema,
    ]),
    StorageModule,
  ],
  providers: [
    MediaService,
    {
      provide: MediaContract,
      useClass: MediaService,
    },
  ],
  exports: [MediaService, MediaContract, MikroOrmModule],
})
export class MediaModule {}
