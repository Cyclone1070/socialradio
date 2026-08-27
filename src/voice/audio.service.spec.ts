import { Test, TestingModule } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';
import { AudioService } from './audio.service';
import { StorageService } from '../infrastructure/storage/storage.service';

describe('AudioService', () => {
  let service: AudioService;

  const mockStorageService = {
    write: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AudioService,
        { provide: StorageService, useValue: mockStorageService },
      ],
    }).compile();

    service = module.get<AudioService>(AudioService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('maps each show persona to its dedicated Neural voice model', () => {
    expect(service.getVoiceForSpeaker('Dave')).toBe('en-US-GuyNeural');
    expect(service.getVoiceForSpeaker('Sarah')).toBe('en-US-JennyNeural');
    expect(service.getVoiceForSpeaker('Caller')).toBe('en-AU-NatashaNeural');
    expect(service.getVoiceForSpeaker('UnknownSpeaker')).toBe(
      'en-US-GuyNeural',
    );
  });

  it('cleans bracketed and parenthetical stage directions from spoken text', () => {
    const raw = '[laughs] That was wild (pauses) mate!';
    expect(service.cleanSpokenText(raw)).toBe('That was wild mate!');
  });

  it('synthesizes multi-speaker script turn-by-turn with persona voices and concatenates audio', async () => {
    const fakeChunk1 = Buffer.from('chunk-dave-audio');
    const fakeChunk2 = Buffer.from('chunk-caller-audio');
    const fakeChunk3 = Buffer.from('chunk-sarah-audio');

    const synthSpy = jest
      .spyOn(service, 'synthesizeTurn')
      .mockImplementation((_text, voice) => {
        if (voice === 'en-US-GuyNeural') return Promise.resolve(fakeChunk1);
        if (voice === 'en-AU-NatashaNeural') return Promise.resolve(fakeChunk2);
        if (voice === 'en-US-JennyNeural') return Promise.resolve(fakeChunk3);
        return Promise.resolve(fakeChunk1);
      });

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
    expect(synthSpy).toHaveBeenCalledTimes(3);
    expect(synthSpy).toHaveBeenNthCalledWith(
      1,
      'Welcome Dave here.',
      'en-US-GuyNeural',
    );
    expect(synthSpy).toHaveBeenNthCalledWith(
      2,
      'Hey there.',
      'en-AU-NatashaNeural',
    );
    expect(synthSpy).toHaveBeenNthCalledWith(
      3,
      'Totally agree.',
      'en-US-JennyNeural',
    );

    // Verify concatenated buffer was written to storage
    const expectedCombined = Buffer.concat([
      fakeChunk1,
      fakeChunk2,
      fakeChunk3,
    ]);

    expect(mockStorageService.write).toHaveBeenCalledWith({
      key: 'talk/segments/seg1.mp3',
      content: expectedCombined,
    });

    expect(result).toEqual({
      filePath: 'talk/segments/seg1.mp3',
      durationSeconds: expectedCombined.length / 6000,
      postIds: ['post-123'],
    });
  });

  it('logs ONE TTS line with sizes + latency at info', async () => {
    jest
      .spyOn(service, 'synthesizeTurn')
      .mockResolvedValue(Buffer.from('fake mp3 audio content'));

    const infoSpy = jest
      .spyOn(PinoLogger.prototype, 'info')
      .mockImplementation(() => {});

    await service.generateSpeech('Hello world', 'talk/test.mp3');

    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        textChars: 'Hello world'.length,
        bytes: Buffer.from('fake mp3 audio content').length,
        outKey: 'talk/test.mp3',
        ms: expect.any(Number) as number,
      }),
      expect.stringContaining('TTS'),
    );
  });
});
