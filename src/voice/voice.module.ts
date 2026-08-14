import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TopicAudio } from './entities/topic-audio.entity';
import { AudioService } from './audio.service';
import { VoiceContract } from '../domain/contracts';
import { StorageModule } from '../infrastructure/storage/storage.module';

@Module({
  imports: [TypeOrmModule.forFeature([TopicAudio]), StorageModule],
  providers: [
    AudioService,
    {
      provide: VoiceContract,
      useClass: AudioService,
    },
  ],
  exports: [AudioService, VoiceContract, TypeOrmModule],
})
export class VoiceModule {}
