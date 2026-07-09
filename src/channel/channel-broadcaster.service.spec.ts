import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ChannelBroadcasterService } from './channel-broadcaster.service';
import { FilesystemService } from '../domain/filesystem.service';
import { QueueGeneratorService } from './queue-generator.service';
import { ChannelPlaylistItem } from './entities/channel-playlist-item.entity';
import { Channel } from './entities/channel.entity';
import { MediaService } from '../media/media.service';
import { Response } from 'express';

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

  beforeEach(async () => {
    jest.useFakeTimers();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChannelBroadcasterService,
        { provide: FilesystemService, useValue: mockFsService },
        { provide: QueueGeneratorService, useValue: mockQueueGen },
        { provide: MediaService, useValue: mockMediaService },
        { provide: getRepositoryToken(Channel), useValue: mockChannelRepo },
        {
          provide: getRepositoryToken(ChannelPlaylistItem),
          useValue: mockPlaylistItemRepo,
        },
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
      const writeHead = jest.fn();
      const onClose = jest.fn();
      const mockRes = {
        writeHead,
        write: jest.fn(),
        on: onClose,
      } as unknown as Response;

      mockChannelRepo.findOneBy.mockResolvedValue({
        id: channelId,
        isPaused: true,
        currentPlaylistItemId: 'item-1',
        pausedOffsetSeconds: 0,
      });
      mockPlaylistItemRepo.findOne.mockResolvedValue({
        id: 'item-1',
        channelId,
        type: 'song',
        audioUrl: 'song.mp3',
        durationSeconds: 180,
        status: 'ready',
      });

      const mockStream = {
        on: jest
          .fn()
          .mockImplementation(
            (event: string, callback: (chunk: Buffer) => void) => {
              if (event === 'data') {
                callback(Buffer.alloc(16000));
              }
              return mockStream;
            },
          ),
        pause: jest.fn(),
        resume: jest.fn(),
        destroy: jest.fn(),
      };
      mockFsService.createReadStream.mockReturnValue(mockStream);

      await service.registerClient(channelId, mockRes);

      expect(writeHead).toHaveBeenCalledWith(
        200,
        expect.objectContaining({
          'Content-Type': 'audio/mpeg',
          Connection: 'keep-alive',
        }) as unknown,
      );
      expect(onClose).toHaveBeenCalledWith(
        'close',
        expect.any(Function) as unknown,
      );
    });
  });
});
