import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Channel } from './entities/channel.entity';
import { ChannelSubreddit } from './entities/channel-subreddit.entity';
import { ChannelPostProgress } from './entities/channel-post-progress.entity';
import {
  Segment,
  SongSegment,
  TalkSegment,
  AdSegment,
  JingleSegment,
} from './entities/segment.entity';
import { ChannelService } from './channel.service';
import { ChannelPlaybackService } from './channel-playback.service';
import { QueueGeneratorService } from './queue-generator.service';
import { ChunkerService } from './chunker.service';
import { ChannelController } from './channel.controller';
import { DomainModule } from '../domain/domain.module';
import { RadioModule } from '../radio/radio.module';
import { MediaModule } from '../media/media.module';
import { PassportModule } from '@nestjs/passport';
import { FeedModule } from '../feed/feed.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Channel,
      ChannelSubreddit,
      ChannelPostProgress,
      Segment,
      SongSegment,
      TalkSegment,
      AdSegment,
      JingleSegment,
    ]),
    DomainModule,
    RadioModule,
    MediaModule,
    PassportModule,
    FeedModule,
    StorageModule,
  ],
  controllers: [ChannelController],
  providers: [
    ChannelService,
    ChannelPlaybackService,
    QueueGeneratorService,
    ChunkerService,
  ],
  exports: [
    ChannelService,
    ChannelPlaybackService,
    ChunkerService,
    TypeOrmModule,
  ],
})
export class ChannelModule {}
