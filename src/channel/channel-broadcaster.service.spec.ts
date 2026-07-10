import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ChannelBroadcasterService } from './channel-broadcaster.service';
import { QueueGeneratorService } from './queue-generator.service';
import { Segment, SongSegment } from './entities/segment.entity';
import { Channel } from './entities/channel.entity';
import { MediaService } from '../media/media.service';
import { Response } from 'express';

describe('ChannelBroadcasterService', () => {
  let service: ChannelBroadcasterService;

  const mockStorageService = {
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

  const mockSegmentRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };

  beforeEach(async () => {
    jest.useFakeTimers();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChannelBroadcasterService,
        { provide: 'StorageService', useValue: mockStorageService },
        { provide: QueueGeneratorService, useValue: mockQueueGen },
        { provide: MediaService, useValue: mockMediaService },
        { provide: getRepositoryToken(Channel), useValue: mockChannelRepo },
        {
          provide: getRepositoryToken(Segment),
          useValue: mockSegmentRepo,
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
        currentSegmentId: 'item-1',
        pausedOffsetSeconds: 0,
      });
      mockSegmentRepo.findOne.mockResolvedValue(
        Object.assign(new SongSegment(), {
          id: 'item-1',
          channelId,
          audioUrl: 'song.mp3',
          durationSeconds: 180,
          title: 'Title',
          artist: 'Artist',
        }),
      );

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
      mockStorageService.createReadStream.mockReturnValue(mockStream);

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
