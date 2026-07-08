import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RadioService } from './radio.service';
import { ScriptService } from './script.service';
import { AudioService } from './audio.service';
import { TopicScript } from './entities/topic-script.entity';
import { TopicAudio } from './entities/topic-audio.entity';
import { Post } from '../feed/entities/post.entity';
import { Comment } from '../feed/entities/comment.entity';

describe('RadioService', () => {
  let service: RadioService;
  let scriptService: ScriptService;
  let audioService: AudioService;

  const mockScriptRepo = {
    findOneBy: jest.fn(),
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
    scriptService = module.get<ScriptService>(ScriptService);
    audioService = module.get<AudioService>(AudioService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getTopicVoiceTrack', () => {
    it('should return cached audio if it exists', async () => {
      const topicId = 'topic-123';
      const cachedAudio = { topicId, filePath: 'cache/topic-123.mp3', durationSeconds: 45.5 };

      mockAudioRepo.findOneBy.mockResolvedValue(cachedAudio);

      const result = await (service as any).getTopicVoiceTrack(topicId);

      expect(mockAudioRepo.findOneBy).toHaveBeenCalledWith({ topicId });
      expect(mockScriptService.generateScript).not.toHaveBeenCalled();
      expect(mockAudioService.generateSpeech).not.toHaveBeenCalled();
      expect(result).toEqual({
        filePath: 'cache/topic-123.mp3',
        durationSeconds: 45.5,
      });
    });

    it('should generate, cache, and return voice track on cache miss', async () => {
      const topicId = 'topic-123';
      mockAudioRepo.findOneBy.mockResolvedValue(null);

      const posts = [{ id: 'post-1', title: 'SpaceX' }] as any[];
      const comments = [{ id: 'comment-1', body: 'Wow' }] as any[];
      mockPostRepo.find.mockResolvedValue(posts);
      mockCommentRepo.find.mockResolvedValue(comments);

      mockScriptService.generateScript.mockResolvedValue('Script content');
      mockAudioService.generateSpeech.mockResolvedValue(30.0); // 30 seconds

      const topicScript = { topicId, scriptText: 'Script content' };
      const filePath = 'assets/cache/tts-topic-topic-123.mp3';
      const topicAudio = { topicId, filePath, durationSeconds: 30.0 };

      mockScriptRepo.create.mockReturnValue(topicScript);
      mockScriptRepo.save.mockResolvedValue(topicScript);
      mockAudioRepo.create.mockReturnValue(topicAudio);
      mockAudioRepo.save.mockResolvedValue(topicAudio);

      const result = await (service as any).getTopicVoiceTrack(topicId);

      expect(mockPostRepo.find).toHaveBeenCalledWith({ where: { topicId } });
      expect(mockCommentRepo.find).toHaveBeenCalledWith({ where: [{ postId: 'post-1' }] });
      expect(mockScriptService.generateScript).toHaveBeenCalledWith(posts, comments);
      expect(mockAudioService.generateSpeech).toHaveBeenCalledWith(
        'Script content',
        expect.stringContaining('topic-123.mp3'),
      );
      expect(mockScriptRepo.create).toHaveBeenCalledWith({ topicId, scriptText: 'Script content' });
      expect(mockAudioRepo.create).toHaveBeenCalledWith({
        topicId,
        filePath: expect.stringContaining('topic-123.mp3'),
        durationSeconds: 30.0,
      });
      expect(result).toEqual({
        filePath: expect.stringContaining('topic-123.mp3'),
        durationSeconds: 30.0,
      });
    });
  });
});
