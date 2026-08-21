import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { AudioService } from './audio.service';
import { VoiceContract } from '../domain/contracts';
import { StorageModule } from '../infrastructure/storage/storage.module';

@Module({
  imports: [HttpModule, ConfigModule, StorageModule],
  providers: [
    AudioService,
    {
      provide: VoiceContract,
      useClass: AudioService,
    },
  ],
  exports: [AudioService, VoiceContract],
})
export class VoiceModule {}
