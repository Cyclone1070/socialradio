import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import {
  MusicTrackSchema,
  AdTrackSchema,
  JingleSchema,
} from '../infrastructure/database/schemas/media.schema';
import { MediaService } from './media.service';
import { MediaContract } from '../domain';

@Module({
  imports: [
    MikroOrmModule.forFeature([MusicTrackSchema, AdTrackSchema, JingleSchema]),
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
