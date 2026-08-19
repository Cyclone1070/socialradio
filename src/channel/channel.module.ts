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
import { PlaybackService } from './playback.service';
import { QueueService } from './queue.service';
import { ChannelController } from './channel.controller';
import { UserModule } from '../user/user.module';
import { PassportModule } from '@nestjs/passport';
import { MediaModule } from '../media/media.module';
import { ContentModule } from '../content/content.module';
import { ScriptModule } from '../script/script.module';
import { VoiceModule } from '../voice/voice.module';

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
    MediaModule,
    ContentModule,
    ScriptModule,
    VoiceModule,
  ],
  controllers: [ChannelController],
  providers: [ChannelService, PlaybackService, QueueService],
  exports: [ChannelService, PlaybackService, QueueService, TypeOrmModule],
})
export class ChannelModule {}
