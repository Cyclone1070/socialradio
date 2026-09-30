import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import {
  ChannelSchema,
  SegmentSchema,
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
import { StorageModule } from '../infrastructure/storage/storage.module';

@Module({
  imports: [
    MikroOrmModule.forFeature([ChannelSchema, SegmentSchema]),
    UserModule,
    PassportModule,
    MediaModule,
    ContentModule,
    ScriptModule,
    VoiceModule,
    StorageModule,
  ],
  controllers: [ChannelController, AdminChannelController],
  providers: [ChannelService, PlaybackService, QueueService],
  exports: [ChannelService, PlaybackService, QueueService, MikroOrmModule],
})
export class ChannelModule {}
