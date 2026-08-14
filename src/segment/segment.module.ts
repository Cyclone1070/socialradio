import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Segment } from './entities/segment.entity';
import { SegmentService } from './segment.service';
import { SegmentContract } from '../domain/contracts';
import { MediaModule } from '../media/media.module';
import { ContentModule } from '../content/content.module';
import { ChannelModule } from '../channel/channel.module';
import { ScriptModule } from '../script/script.module';
import { VoiceModule } from '../voice/voice.module';
import { UserModule } from '../user/user.module';
import { PassportModule } from '@nestjs/passport';
import { AdminSegmentController } from './admin-segment.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Segment]),
    MediaModule,
    ContentModule,
    ChannelModule,
    ScriptModule,
    VoiceModule,
    UserModule,
    PassportModule,
  ],
  controllers: [AdminSegmentController],
  providers: [
    SegmentService,
    {
      provide: SegmentContract,
      useClass: SegmentService,
    },
  ],
  exports: [SegmentService, SegmentContract, TypeOrmModule],
})
export class SegmentModule {}
