import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChannelBroadcasterService } from './channel-broadcaster.service';
import { FilesystemService } from '../domain/filesystem.service';
import { QueueGeneratorService } from './queue-generator.service';
import { ChannelPlaylistItem } from './entities/channel-playlist-item.entity';
import { Channel } from './entities/channel.entity';
import { ChannelTopicProgress } from './entities/channel-topic-progress.entity';
import { MediaService } from '../media/media.service';

describe('ChannelBroadcasterService', () => {
  let service: ChannelBroadcasterService;

  const mockFsService = {
    createReadStream: jest.fn(),
  };

  const mockQueueGen = {
    bufferAhead: jest.fn(),
  };

  const mockMediaService = {
    getRandomAd: jest.fn(),
  };

  const mockChannelRepo = {
    findOneBy: jest.fn(),
    save: jest.fn(),
  };

  const mockPlaylistItemRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };

  const mockProgressRepo = {
    create: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    jest.useFakeTimers();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChannelBroadcasterService,
        { provide: FilesystemService, useValue: mockFsService },
        { provide: QueueGeneratorService, useValue: mockQueueGen },
        { provide: MediaService, useValue: mockMediaService },
        { provide: getRepositoryToken(Channel), useValue: mockChannelRepo },
        { provide: getRepositoryToken(ChannelPlaylistItem), useValue: mockPlaylistItemRepo },
        { provide: getRepositoryToken(ChannelTopicProgress), useValue: mockProgressRepo },
      ],
    }).compile();

    service = module.get<ChannelBroadcasterService>(ChannelBroadcasterService);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('registerClient', () => {
    it('should set headers, register client, and start transmission if first client', async () => {
      const channelId = 'chan-1';
      const mockRes = {
        writeHead: jest.fn(),
        write: jest.fn(),
        on: jest.fn(),
      } as any;

      mockChannelRepo.findOneBy.mockResolvedValue({ id: channelId, isPaused: true, currentPlaylistItemId: 'item-1', pausedOffsetSeconds: 0 });
      mockPlaylistItemRepo.findOne.mockResolvedValue({
        id: 'item-1',
        channelId,
        type: 'song',
        audioUrl: 'song.mp3',
        durationSeconds: 180,
        status: 'ready',
      });

      const mockStream = {
        on: jest.fn().mockImplementation((event, callback) => {
          if (event === 'data') {
            callback(Buffer.alloc(16000));
          }
          return mockStream;
        }),
        pause: jest.fn(),
        resume: jest.fn(),
        destroy: jest.fn(),
      };
      mockFsService.createReadStream.mockReturnValue(mockStream);

      await service.registerClient(channelId, mockRes);

      expect(mockRes.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
        'Content-Type': 'audio/mpeg',
        'Connection': 'keep-alive',
      }));
      expect(mockRes.on).toHaveBeenCalledWith('close', expect.any(Function));
    });
  });
});
