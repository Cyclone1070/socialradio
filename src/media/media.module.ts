import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import {
  MusicTrackSchema,
  JingleSchema,
  LinerSchema,
} from '../infrastructure/database/schemas/media.schema';
import { MediaService } from './media.service';
import { MediaContract } from '../domain';
import { StorageModule } from '../infrastructure/storage/storage.module';

@Module({
  imports: [
    MikroOrmModule.forFeature([MusicTrackSchema, JingleSchema, LinerSchema]),
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
