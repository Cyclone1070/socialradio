import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { AudioService } from './audio.service';
import { ConfigService } from '@nestjs/config';

describe('AudioService', () => {
  let service: AudioService;

  const mockHttpService = {
    post: jest.fn(),
  };

  const mockStorageService = {
    write: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'TTS_API_KEY') return 'mock_key';
      return null;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AudioService,
        { provide: HttpService, useValue: mockHttpService },
        { provide: 'StorageService', useValue: mockStorageService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AudioService>(AudioService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateSpeech', () => {
    it('should call Google Studio TTS API, decode base64 audioContent, write binary file to disk, and return duration', async () => {
      // 16,000 bytes = 1.0 second of 128kbps audio
      const mockAudioBuffer = Buffer.alloc(16000);
      const mockBase64Content = mockAudioBuffer.toString('base64');

      const response: AxiosResponse = {
        data: {
          audioContent: mockBase64Content,
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      };

      mockHttpService.post.mockReturnValue(of(response));
      mockStorageService.write.mockResolvedValue(undefined);

      const result = await service.generateSpeech(
        'Hello from social radio',
        'cache/test.mp3',
      );

      expect(mockHttpService.post).toHaveBeenCalledWith(
        'https://texttospeech.googleapis.com/v1/text:synthesize?key=mock_key',
        expect.objectContaining({
          input: { text: 'Hello from social radio' },
          voice: { languageCode: 'en-US', name: 'en-US-Studio-O' },
          audioConfig: { audioEncoding: 'MP3' },
        }),
        expect.any(Object),
      );
      expect(mockStorageService.write).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'cache/test.mp3',
          content: mockAudioBuffer,
        }) as unknown,
      );
      expect(result).toBe(1.0); // 16000 / 16000 = 1.0s
    });
  });
});
