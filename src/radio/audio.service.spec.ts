import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AudioService } from './audio.service';
import { of } from 'rxjs';
import type { AxiosResponse } from 'axios';

describe('AudioService', () => {
  let service: AudioService;

  const mockHttpService = {
    post: jest.fn(),
  };

  const mockStorageService = {
    write: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AudioService,
        { provide: HttpService, useValue: mockHttpService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'GEMINI_API_KEY') return 'test_gemini_key';
              return null;
            }),
          },
        },
        { provide: 'StorageService', useValue: mockStorageService },
      ],
    }).compile();

    service = module.get<AudioService>(AudioService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should call Google TTS endpoint and save output buffer to storage', async () => {
    const fakeAudioBase64 = Buffer.from('fake mp3 audio content').toString(
      'base64',
    );
    const mockAxiosResponse: Partial<AxiosResponse> = {
      data: { audioContent: fakeAudioBase64 },
    };

    mockHttpService.post.mockReturnValue(of(mockAxiosResponse));

    const duration = await service.generateSpeech(
      'Hello world',
      'talk/test.mp3',
    );

    expect(mockHttpService.post).toHaveBeenCalledWith(
      'https://texttospeech.googleapis.com/v1/text:synthesize?key=test_gemini_key',
      expect.objectContaining({
        input: { text: 'Hello world' },
      }),
      expect.any(Object),
    );
    expect(mockStorageService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'talk/test.mp3',
      }),
    );
    expect(duration).toBeGreaterThan(0);
  });
});
