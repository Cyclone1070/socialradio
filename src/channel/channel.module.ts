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
import { ChannelQueryService } from './channel-query.service';
import { ChunkerService } from './chunker.service';
import { ChannelController } from './channel.controller';
import { UserModule } from '../user/user.module';
import { PassportModule } from '@nestjs/passport';
import { StorageModule } from '../infrastructure/storage/storage.module';
import { ChannelContract } from '../domain/contracts';

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
    UserModule,
    PassportModule,
    StorageModule,
  ],
  controllers: [ChannelController],
  providers: [
    ChannelService,
    ChannelPlaybackService,
    ChannelQueryService,
    ChunkerService,
    {
      provide: ChannelContract,
      useClass: ChannelQueryService,
    },
  ],
  exports: [
    ChannelService,
    ChannelPlaybackService,
    ChannelQueryService,
    ChannelContract,
    ChunkerService,
    TypeOrmModule,
  ],
})
export class ChannelModule {}
