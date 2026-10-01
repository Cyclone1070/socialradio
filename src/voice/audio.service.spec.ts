import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AudioService } from './audio.service';
import { StorageService } from '../infrastructure/storage/storage.service';

/**
 * The app no longer knows how speech is made. It sends the script to the voice
 * service and stores what comes back, along with the length the service measured
 * for that audio. Voices, concatenation and formats live on the other side of this
 * boundary, which is what makes the engine swappable.
 */
describe('AudioService', () => {
  let service: AudioService;
  let fetchMock: jest.SpyInstance;

  const audio = Buffer.from([0xff, 0xf3, 0x64, 0xc4, 0x00, 0x01]);

  const mockStorageService = {
    write: jest.fn<Promise<void>, [{ key: string; content: Buffer }]>(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'VOICE_SERVICE_URL') return 'http://voice:3002';
      return null;
    }),
  };

  const script = {
    postId: 'post-123',
    turns: [
      { speaker: 'Dave', text: 'Welcome to the show.' },
      { speaker: 'Sarah', text: 'Glad to be here.' },
    ],
  };

  const respondWith = (init: {
    ok: boolean;
    status?: number;
    duration?: string | null;
    body?: Buffer;
  }): void => {
    fetchMock.mockResolvedValue({
      ok: init.ok,
      status: init.status ?? 200,
      headers: new Headers(
        init.duration === undefined || init.duration === null
          ? {}
          : { 'x-duration-seconds': init.duration },
      ),
      arrayBuffer: () =>
        Promise.resolve(new Uint8Array(init.body ?? audio).buffer),
    });
  };

  beforeEach(async () => {
    fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    } as Response);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AudioService,
        { provide: StorageService, useValue: mockStorageService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AudioService>(AudioService);
    jest.clearAllMocks();
    mockStorageService.write.mockResolvedValue(undefined);
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('sends the script to the voice service and stores the audio it answers with', async () => {
    respondWith({ ok: true, duration: '4.632' });

    const result = await service.synthesizeScript(script, 'audio/talk-x.mp3');

    expect(fetchMock).toHaveBeenCalledWith('http://voice:3002/synthesize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(script),
    });
    expect(mockStorageService.write).toHaveBeenCalledTimes(1);
    const [written] = mockStorageService.write.mock.calls[0];
    expect(written.key).toBe('audio/talk-x.mp3');
    expect(written.content).toEqual(audio);
    expect(result).toEqual({
      filePath: 'audio/talk-x.mp3',
      // The service measured this from the audio it produced; the app only records
      // it, so the queue advances by the truth rather than by an estimate.
      durationSeconds: 4.632,
      postIds: ['post-123'],
    });
  });

  it('fails loudly when the voice service answers with an error', async () => {
    respondWith({ ok: false, status: 502 });

    await expect(
      service.synthesizeScript(script, 'audio/talk-x.mp3'),
    ).rejects.toThrow(/502/);
    expect(mockStorageService.write).not.toHaveBeenCalled();
  });

  it('fails loudly rather than storing audio with an unusable length', async () => {
    respondWith({ ok: true, duration: 'not-a-number' });

    await expect(
      service.synthesizeScript(script, 'audio/talk-x.mp3'),
    ).rejects.toThrow(/duration/i);
    expect(mockStorageService.write).not.toHaveBeenCalled();
  });

  it('refuses to guess an address when the voice service is not configured', async () => {
    mockConfigService.get.mockReturnValueOnce(null);

    await expect(
      service.synthesizeScript(script, 'audio/talk-x.mp3'),
    ).rejects.toThrow(/VOICE_SERVICE_URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
