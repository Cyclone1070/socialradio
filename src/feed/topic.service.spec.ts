import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TopicService } from './topic.service';
import { Post } from './entities/post.entity';
import { Topic } from '../domain/entities/topic.entity';

// Mock the huggingface transformers library to avoid network downloads in unit tests
jest.mock('@huggingface/transformers', () => ({
  pipeline: jest.fn().mockResolvedValue(
    jest.fn().mockImplementation((text: string) => {
      // Return custom deterministic vector based on text length to simulate different embeddings
      const vec = new Array(384).fill(0);
      vec[0] = text.length / 100;
      return {
        data: new Float32Array(vec),
      };
    }),
  ),
}));

describe('TopicService', () => {
  let service: TopicService;
  let postRepo: Repository<Post>;
  let topicRepo: Repository<Topic>;

  const mockPostRepo = {
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockTopicRepo = {
    create: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TopicService,
        { provide: getRepositoryToken(Post), useValue: mockPostRepo },
        { provide: getRepositoryToken(Topic), useValue: mockTopicRepo },
      ],
    }).compile();

    service = module.get<TopicService>(TopicService);
    postRepo = module.get<Repository<Post>>(getRepositoryToken(Post));
    topicRepo = module.get<Repository<Topic>>(getRepositoryToken(Topic));
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('categorizeNewPosts', () => {
    it('should cluster a post into a new topic if no similar posts exist', async () => {
      const subredditId = 'sub-uuid';
      const newPost = {
        title: 'Entirely new story about bananas',
        body: 'body text',
        redditId: 'reddit-1',
        subredditId,
        score: 10,
        commentCount: 5,
        permalink: 'link',
        redditCreatedAt: new Date(),
      } as any;

      mockPostRepo.find.mockResolvedValue([]); // No existing active posts in last 24h
      const mockTopic = { id: 'topic-uuid-1', subredditId };
      mockTopicRepo.create.mockReturnValue(mockTopic);
      mockTopicRepo.save.mockResolvedValue(mockTopic);

      await (service as any).categorizeNewPosts(subredditId, [newPost]);

      expect(mockPostRepo.find).toHaveBeenCalled();
      expect(mockTopicRepo.create).toHaveBeenCalledWith({ subredditId });
      expect(mockTopicRepo.save).toHaveBeenCalledWith(mockTopic);
      expect(newPost.topicId).toBe('topic-uuid-1');
      expect(newPost.titleEmbedding).toBeDefined();
      expect(mockPostRepo.save).toHaveBeenCalledWith([newPost]);
    });

    it('should cluster a post into an existing topic if cosine similarity is >= 0.75', async () => {
      const subredditId = 'sub-uuid';
      // Post 1 title: "SpaceX launches Falcon Heavy"
      // Post 2 title: "SpaceX launches Falcon Heavy" (identical titles -> similarity 1.0)
      const existingEmbedding = new Array(384).fill(0);
      existingEmbedding[0] = 'SpaceX launches Falcon Heavy'.length / 100;

      const existingPost = {
        id: 'post-existing',
        title: 'SpaceX launches Falcon Heavy',
        topicId: 'topic-existing-123',
        titleEmbedding: existingEmbedding,
      } as any;

      const newPost = {
        title: 'SpaceX launches Falcon Heavy', // exact same title
        body: 'body text',
        redditId: 'reddit-2',
        subredditId,
        score: 10,
        commentCount: 5,
        permalink: 'link',
        redditCreatedAt: new Date(),
      } as any;

      mockPostRepo.find.mockResolvedValue([existingPost]);
      mockTopicRepo.save.mockImplementation((t) => Promise.resolve(t));

      await (service as any).categorizeNewPosts(subredditId, [newPost]);

      expect(mockTopicRepo.create).not.toHaveBeenCalled();
      expect(newPost.topicId).toBe('topic-existing-123');
      expect(mockPostRepo.save).toHaveBeenCalledWith([newPost]);
    });
  });
});
