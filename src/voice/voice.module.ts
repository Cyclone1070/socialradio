import { Module } from '@nestjs/common';
import { AudioService } from './audio.service';
import { VoiceContract } from '../domain/contracts';
import { StorageModule } from '../infrastructure/storage/storage.module';

@Module({
  imports: [StorageModule],
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
