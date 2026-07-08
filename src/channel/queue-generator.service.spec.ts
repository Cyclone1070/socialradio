import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QueueGeneratorService } from './queue-generator.service';
import { ChannelPlaylistItem } from './entities/channel-playlist-item.entity';
import { ChannelSubreddit } from './entities/channel-subreddit.entity';
import { ChannelTopicProgress } from './entities/channel-topic-progress.entity';
import { Topic } from '../domain/entities/topic.entity';
import { RadioService } from '../radio/radio.service';
import { MediaService } from '../media/media.service';

describe('QueueGeneratorService', () => {
  let service: QueueGeneratorService;
  let radioService: RadioService;
  let mediaService: MediaService;

  const mockPlaylistItemRepo = {
    count: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockSubredditRepo = {
    find: jest.fn(),
  };

  const mockProgressRepo = {
    find: jest.fn(),
  };

  const mockTopicRepo = {
    find: jest.fn(),
  };

  const mockRadioService = {
    getTopicVoiceTrack: jest.fn(),
  };

  const mockMediaService = {
    getRandomMusic: jest.fn(),
    getRandomAd: jest.fn(),
    getRandomJingle: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueGeneratorService,
        { provide: getRepositoryToken(ChannelPlaylistItem), useValue: mockPlaylistItemRepo },
        { provide: getRepositoryToken(ChannelSubreddit), useValue: mockSubredditRepo },
        { provide: getRepositoryToken(ChannelTopicProgress), useValue: mockProgressRepo },
        { provide: getRepositoryToken(Topic), useValue: mockTopicRepo },
        { provide: RadioService, useValue: mockRadioService },
        { provide: MediaService, useValue: mockMediaService },
      ],
    }).compile();

    service = module.get<QueueGeneratorService>(QueueGeneratorService);
    radioService = module.get<RadioService>(RadioService);
    mediaService = module.get<MediaService>(MediaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('bufferAhead', () => {
    it('should generate media items and queue a talk item if queue is low', async () => {
      const channelId = 'chan-1';

      // Mock queue has 0 future items, so it needs to generate more
      mockPlaylistItemRepo.count.mockResolvedValue(0);
      mockPlaylistItemRepo.findOne.mockResolvedValue(null);
      mockPlaylistItemRepo.find.mockResolvedValue([]); // No existing items

      // Mock subscription to subreddit 'sub-1'
      mockSubredditRepo.find.mockResolvedValue([{ subredditId: 'sub-1' }]);

      // Mock 0 completed topics
      mockProgressRepo.find.mockResolvedValue([]);

      // Mock 1 available topic in that subreddit
      const topic = { id: 'topic-123', subredditId: 'sub-1' };
      mockTopicRepo.find.mockResolvedValue([topic]);

      // Mock MediaService helper responses
      mockMediaService.getRandomJingle.mockResolvedValue({ filePath: 'jingle.mp3', durationSeconds: 5 });
      mockMediaService.getRandomMusic.mockResolvedValue({ filePath: 'song.mp3', durationSeconds: 180 });
      mockMediaService.getRandomAd.mockResolvedValue({ filePath: 'ad.mp3', durationSeconds: 30 });

      // Mock RadioService voice generation
      mockRadioService.getTopicVoiceTrack.mockResolvedValue({ filePath: 'tts.mp3', durationSeconds: 60 });

      // We expect it to save items sequentially:
      // Jingle (ready) -> Talk (generating) -> Song (ready) -> Ad (ready) -> Song (ready)
      const mockSavedItems: any[] = [];
      mockPlaylistItemRepo.create.mockImplementation((dto) => dto);
      mockPlaylistItemRepo.save.mockImplementation((item) => {
        mockSavedItems.push(item);
        return Promise.resolve({ id: 'uuid-' + mockSavedItems.length, ...item });
      });

      await (service as any).bufferAhead(channelId);

      expect(mockPlaylistItemRepo.count).toHaveBeenCalled();
      expect(mockMediaService.getRandomJingle).toHaveBeenCalled();
      expect(mockMediaService.getRandomMusic).toHaveBeenCalled();
      expect(mockMediaService.getRandomAd).toHaveBeenCalled();
      expect(mockRadioService.getTopicVoiceTrack).toHaveBeenCalledWith('topic-123');

      // Check queued items order:
      expect(mockSavedItems[0].type).toBe('jingle');
      expect(mockSavedItems[0].status).toBe('ready');

      expect(mockSavedItems[1].type).toBe('talk');
      expect(mockSavedItems[1].topicId).toBe('topic-123');
      // Talk item should start as 'generating', then update to 'ready' after RadioService completes
      expect(mockRadioService.getTopicVoiceTrack).toHaveBeenCalled();
    });
  });
});
