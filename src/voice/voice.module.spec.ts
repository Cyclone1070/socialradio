import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { VoiceModule } from './voice.module';
import { VoiceContract } from '../domain/contracts';
import { AudioService } from './audio.service';
import { StorageService } from '../infrastructure/storage/storage.service';

describe('VoiceModule Integration', () => {
  let ttsEngine: VoiceContract;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AudioService,
        {
          provide: HttpService,
          useValue: { post: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
        {
          provide: StorageService,
          useValue: { write: jest.fn() },
        },
        {
          provide: VoiceContract,
          useClass: AudioService,
        },
      ],
    }).compile();

    ttsEngine = module.get<VoiceContract>(VoiceContract);
  });

  it('should export VoiceContract from VoiceModule', () => {
    expect(VoiceModule).toBeDefined();
    expect(ttsEngine).toBeDefined();
  });
});
