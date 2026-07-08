import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { AudioService } from './audio.service';
import { FilesystemService } from '../domain/filesystem.service';
import { ConfigService } from '@nestjs/config';

describe('AudioService', () => {
  let service: AudioService;

  const mockHttpService = {
    post: jest.fn(),
  };

  const mockFsService = {
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
        { provide: FilesystemService, useValue: mockFsService },
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
    it('should call TTS API, write file to disk, and return duration based on CBR math', async () => {
      // 16,000 bytes = 1.0 second of 128kbps audio
      const mockAudioBuffer = Buffer.alloc(16000);
      const response: AxiosResponse = {
        data: mockAudioBuffer,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      };

      mockHttpService.post.mockReturnValue(of(response));
      mockFsService.write.mockResolvedValue(undefined);

      const result = await service.generateSpeech(
        'Hello from social radio',
        'cache/test.mp3',
      );

      expect(mockHttpService.post).toHaveBeenCalledWith(
        'https://api.openai.com/v1/audio/speech',
        expect.objectContaining({
          input: 'Hello from social radio',
          model: 'tts-1',
          voice: 'alloy',
          response_format: 'mp3',
        }),
        expect.any(Object),
      );
      expect(mockFsService.write).toHaveBeenCalledWith(
        'cache/test.mp3',
        mockAudioBuffer,
      );
      expect(result).toBe(1.0); // 16000 / 16000 = 1.0s
    });
  });
});
