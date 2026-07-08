import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MusicTrack } from './entities/music-track.entity';
import { AdTrack } from './entities/ad-track.entity';
import { Jingle } from './entities/jingle.entity';
import { MediaService } from './media.service';

@Module({
  imports: [TypeOrmModule.forFeature([MusicTrack, AdTrack, Jingle])],
  providers: [MediaService],
  exports: [MediaService, TypeOrmModule],
})
export class MediaModule {}
