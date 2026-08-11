import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { RadioService } from './radio.service';
import { ScriptService } from './script.service';
import { AudioService } from './audio.service';
import { TopicScript } from './entities/topic-script.entity';
import { TopicAudio } from './entities/topic-audio.entity';
import { Post } from '../feed/entities/post.entity';
import { Comment } from '../feed/entities/comment.entity';

describe('RadioService', () => {
  let service: RadioService;

  const mockScriptRepo = {
    create: jest.fn(),
    save: jest.fn(),
  };
  const mockAudioRepo = {
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };
  const mockPostRepo = {
    find: jest.fn(),
  };
  const mockCommentRepo = {
    find: jest.fn(),
  };
  const mockScriptService = {
    generateScript: jest.fn(),
  };
  const mockAudioService = {
    generateSpeech: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RadioService,
        { provide: getRepositoryToken(TopicScript), useValue: mockScriptRepo },
        { provide: getRepositoryToken(TopicAudio), useValue: mockAudioRepo },
        { provide: getRepositoryToken(Post), useValue: mockPostRepo },
        { provide: getRepositoryToken(Comment), useValue: mockCommentRepo },
        { provide: ScriptService, useValue: mockScriptService },
        { provide: AudioService, useValue: mockAudioService },
      ],
    }).compile();

    service = module.get<RadioService>(RadioService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getSegmentVoiceTrack', () => {
    it('returns the cached track without regenerating, logging a debug cache hit', async () => {
      mockAudioRepo.findOneBy.mockResolvedValue({
        id: 'audio-1',
        postId: 'post-1',
        filePath: 'assets/cache/tts-post-1.mp3',
        durationSeconds: 60,
      });

      const debugSpy = jest
        .spyOn(PinoLogger.prototype, 'debug')
        .mockImplementation(() => {});

      const result = await service.getSegmentVoiceTrack(['post-1']);

      expect(result).toEqual({
        filePath: 'assets/cache/tts-post-1.mp3',
        durationSeconds: 60,
        postIds: ['post-1'],
      });
      expect(mockScriptService.generateScript).not.toHaveBeenCalled();
      expect(debugSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          postIds: ['post-1'],
          cacheHit: true,
        }),
        expect.stringContaining('cache'),
      );
    });

    it('generates + persists script and audio, logging ONE info line', async () => {
      mockAudioRepo.findOneBy.mockResolvedValue(null);
      mockPostRepo.find.mockResolvedValue([
        { id: 'post-1', title: 'T', body: 'B' },
      ]);
      mockCommentRepo.find.mockResolvedValue([]);
      mockScriptService.generateScript.mockResolvedValue('Script text.');
      mockAudioService.generateSpeech.mockResolvedValue(42);
      mockScriptRepo.create.mockImplementation((dto) => dto as TopicScript);
      mockScriptRepo.save.mockImplementation((dto) =>
        Promise.resolve(dto as TopicScript),
      );
      mockAudioRepo.create.mockImplementation((dto) => dto as TopicAudio);
      mockAudioRepo.save.mockImplementation((dto) =>
        Promise.resolve(dto as TopicAudio),
      );

      const infoSpy = jest
        .spyOn(PinoLogger.prototype, 'info')
        .mockImplementation(() => {});

      const result = await service.getSegmentVoiceTrack(['post-1']);

      expect(result.filePath).toBe('assets/cache/tts-post-post-1.mp3');
      expect(result.durationSeconds).toBe(42);
      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          postIds: ['post-1'],
          durationSeconds: 42,
          ms: expect.any(Number) as number,
        }),
        expect.stringContaining('voice'),
      );
    });
  });
});
