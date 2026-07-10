import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RadioService } from './radio.service';
import { TopicScript } from './entities/topic-script.entity';
import { TopicAudio } from './entities/topic-audio.entity';
import { Post } from '../feed/entities/post.entity';
import { Comment } from '../feed/entities/comment.entity';
import { ScriptService } from './script.service';
import { AudioService } from './audio.service';

describe('RadioService', () => {
  let service: RadioService;

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
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getSegmentVoiceTrack', () => {
    it('should return cached audio if it exists', async () => {
      const postIds = ['post-123'];
      const cachedAudio = {
        postId: 'post-123',
        filePath: 'cache/post-123.mp3',
        durationSeconds: 45.5,
      };

      mockAudioRepo.findOneBy.mockResolvedValue(cachedAudio);

      const result = await service.getSegmentVoiceTrack(postIds);

      expect(mockAudioRepo.findOneBy).toHaveBeenCalledWith({
        postId: 'post-123',
      });
      expect(mockScriptService.generateScript).not.toHaveBeenCalled();
      expect(mockAudioService.generateSpeech).not.toHaveBeenCalled();
      expect(result).toEqual({
        filePath: 'cache/post-123.mp3',
        durationSeconds: 45.5,
        postIds,
      });
    });

    it('should generate, cache, and return voice track on cache miss', async () => {
      const postIds = ['post-123'];
      mockAudioRepo.findOneBy.mockResolvedValue(null);

      const posts = [{ id: 'post-123', title: 'SpaceX' }] as unknown as Post[];
      const comments = [
        { id: 'comment-1', body: 'Wow', postId: 'post-123' },
      ] as unknown as Comment[];
      mockPostRepo.find.mockResolvedValue(posts);
      mockCommentRepo.find.mockResolvedValue(comments);

      mockScriptService.generateScript.mockResolvedValue('Script content');
      mockAudioService.generateSpeech.mockResolvedValue(30.0); // 30 seconds

      const topicScript = { postId: 'post-123', scriptText: 'Script content' };
      const filePath = 'assets/cache/tts-post-post-123.mp3';
      const topicAudio = {
        postId: 'post-123',
        filePath,
        durationSeconds: 30.0,
      };

      mockScriptRepo.create.mockReturnValue(topicScript);
      mockScriptRepo.save.mockResolvedValue(topicScript);
      mockAudioRepo.create.mockReturnValue(topicAudio);
      mockAudioRepo.save.mockResolvedValue(topicAudio);

      const result = await service.getSegmentVoiceTrack(postIds);

      expect(mockPostRepo.find).toHaveBeenCalledWith({
        where: [{ id: 'post-123' }],
      });
      expect(mockCommentRepo.find).toHaveBeenCalledWith({
        where: [{ postId: 'post-123' }],
      });
      expect(mockScriptService.generateScript).toHaveBeenCalledWith(
        posts,
        comments,
      );
      expect(mockAudioService.generateSpeech).toHaveBeenCalledWith(
        'Script content',
        expect.stringContaining('post-123.mp3'),
      );
      expect(mockScriptRepo.create).toHaveBeenCalledWith({
        postId: 'post-123',
        scriptText: 'Script content',
      });
      expect(mockAudioRepo.create).toHaveBeenCalledWith({
        postId: 'post-123',
        filePath: expect.stringContaining('post-123.mp3') as unknown,
        durationSeconds: 30.0,
      });
      expect(result).toEqual({
        filePath: expect.stringContaining('post-123.mp3') as unknown,
        durationSeconds: 30.0,
        postIds,
      });
    });
  });
});
