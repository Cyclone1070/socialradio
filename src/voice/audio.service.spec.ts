import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { PinoLogger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { AudioService } from './audio.service';
import { StorageService } from '../infrastructure/storage/storage.service';
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
        { provide: StorageService, useValue: mockStorageService },
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

  it('logs ONE TTS line with sizes + latency at info', async () => {
    const fakeAudioBase64 = Buffer.from('fake mp3 audio content').toString(
      'base64',
    );
    mockHttpService.post.mockReturnValue(
      of({ data: { audioContent: fakeAudioBase64 } } as Partial<AxiosResponse>),
    );

    const infoSpy = jest
      .spyOn(PinoLogger.prototype, 'info')
      .mockImplementation(() => {});

    await service.generateSpeech('Hello world', 'talk/test.mp3');

    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        textChars: 'Hello world'.length,
        bytes: Buffer.from(fakeAudioBase64, 'base64').length,
        outKey: 'talk/test.mp3',
        ms: expect.any(Number) as number,
      }),
      expect.stringContaining('TTS'),
    );
  });

  it('maps each show persona to its dedicated Neural2 voice model', () => {
    expect(service.getVoiceForSpeaker('Dave')).toBe('en-US-Neural2-J');
    expect(service.getVoiceForSpeaker('Sarah')).toBe('en-US-Neural2-F');
    expect(service.getVoiceForSpeaker('Caller')).toBe('en-US-Neural2-I');
    expect(service.getVoiceForSpeaker('UnknownSpeaker')).toBe(
      'en-US-Neural2-J',
    );
  });

  it('cleans bracketed and parenthetical stage directions from spoken text', () => {
    const raw = '[laughs] That was wild (pauses) mate!';
    expect(service.cleanSpokenText(raw)).toBe('That was wild mate!');
  });

  it('synthesizes multi-speaker script turn-by-turn with persona voices and concatenates audio', async () => {
    const fakeChunk1 = Buffer.from('chunk-dave-audio').toString('base64');
    const fakeChunk2 = Buffer.from('chunk-caller-audio').toString('base64');
    const fakeChunk3 = Buffer.from('chunk-sarah-audio').toString('base64');

    mockHttpService.post
      .mockReturnValueOnce(of({ data: { audioContent: fakeChunk1 } }))
      .mockReturnValueOnce(of({ data: { audioContent: fakeChunk2 } }))
      .mockReturnValueOnce(of({ data: { audioContent: fakeChunk3 } }));

    const script = {
      postId: 'post-123',
      turns: [
        { speaker: 'Dave', text: '[laughs] Welcome Dave here.' },
        { speaker: 'Caller', text: 'Hey [pauses] there.' },
        { speaker: 'Sarah', text: 'Totally agree.' },
      ],
    };

    const result = await service.synthesizeScript(
      script,
      'talk/segments/seg1.mp3',
    );

    // Verify 3 distinct TTS calls with correct persona voices
    expect(mockHttpService.post).toHaveBeenCalledTimes(3);

    expect(mockHttpService.post).toHaveBeenNthCalledWith(
      1,
      'https://texttospeech.googleapis.com/v1/text:synthesize?key=test_gemini_key',
      expect.objectContaining({
        input: { text: 'Welcome Dave here.' },
        voice: { languageCode: 'en-US', name: 'en-US-Neural2-J' },
      }),
      expect.any(Object),
    );

    expect(mockHttpService.post).toHaveBeenNthCalledWith(
      2,
      'https://texttospeech.googleapis.com/v1/text:synthesize?key=test_gemini_key',
      expect.objectContaining({
        input: { text: 'Hey there.' },
        voice: { languageCode: 'en-US', name: 'en-US-Neural2-I' },
      }),
      expect.any(Object),
    );

    expect(mockHttpService.post).toHaveBeenNthCalledWith(
      3,
      'https://texttospeech.googleapis.com/v1/text:synthesize?key=test_gemini_key',
      expect.objectContaining({
        input: { text: 'Totally agree.' },
        voice: { languageCode: 'en-US', name: 'en-US-Neural2-F' },
      }),
      expect.any(Object),
    );

    // Verify concatenated buffer was written to storage
    const expectedCombined = Buffer.concat([
      Buffer.from(fakeChunk1, 'base64'),
      Buffer.from(fakeChunk2, 'base64'),
      Buffer.from(fakeChunk3, 'base64'),
    ]);

    expect(mockStorageService.write).toHaveBeenCalledWith({
      key: 'talk/segments/seg1.mp3',
      content: expectedCombined,
    });

    expect(result).toEqual({
      filePath: 'talk/segments/seg1.mp3',
      durationSeconds: expectedCombined.length / 16000,
      postIds: ['post-123'],
    });
  });
});
