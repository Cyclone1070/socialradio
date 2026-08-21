import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import {
  ChannelSchema,
  SegmentSchema,
  MusicSegmentSchema,
  TalkSegmentSchema,
  AdSegmentSchema,
  JingleSegmentSchema,
} from '../infrastructure/database/schemas/channel.schema';
import { ChannelService } from './channel.service';
import { PlaybackService } from './playback.service';
import { QueueService } from './queue.service';
import { ChannelController } from './channel.controller';
import { AdminChannelController } from './admin-channel.controller';
import { UserModule } from '../user/user.module';
import { PassportModule } from '@nestjs/passport';
import { MediaModule } from '../media/media.module';
import { ContentModule } from '../content/content.module';
import { ScriptModule } from '../script/script.module';
import { VoiceModule } from '../voice/voice.module';

@Module({
  imports: [
    MikroOrmModule.forFeature([
      ChannelSchema,
      SegmentSchema,
      MusicSegmentSchema,
      TalkSegmentSchema,
      AdSegmentSchema,
      JingleSegmentSchema,
    ]),
    UserModule,
    PassportModule,
    MediaModule,
    ContentModule,
    ScriptModule,
    VoiceModule,
  ],
  controllers: [ChannelController, AdminChannelController],
  providers: [ChannelService, PlaybackService, QueueService],
  exports: [ChannelService, PlaybackService, QueueService, MikroOrmModule],
})
export class ChannelModule {}
