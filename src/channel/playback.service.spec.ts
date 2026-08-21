import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@mikro-orm/nestjs';
import { EntityManager } from '@mikro-orm/postgresql';
import { PlaybackService } from './playback.service';
import { QueueService } from './queue.service';
import { MediaContract } from '../domain';
import { Channel } from './entities/channel.entity';
import { MusicSegment, TalkSegment } from './entities/segment.entity';
import {
  ChannelSchema,
  SegmentSchema,
} from '../infrastructure/database/schemas/channel.schema';

describe('PlaybackService', () => {
  let service: PlaybackService;
  let mathRandomSpy: jest.SpyInstance;

  const mockChannelRepo = {
    findOne: jest.fn(),
  };

  const mockSegmentRepo = {
    findOne: jest.fn(),
    count: jest.fn(),
    nativeDelete: jest.fn(),
  };

  const mockEntityManager = {
    flush: jest.fn(),
  };

  const mockQueueService = {
    bufferAhead: jest.fn().mockResolvedValue(undefined),
  };

  const mockMediaService = {
    getRandomJingle: jest.fn().mockResolvedValue({
      filePath: 'jingle.mp3',
      durationSeconds: 5,
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaybackService,
        {
          provide: getRepositoryToken(ChannelSchema),
          useValue: mockChannelRepo,
        },
        {
          provide: getRepositoryToken(SegmentSchema),
          useValue: mockSegmentRepo,
        },
        { provide: EntityManager, useValue: mockEntityManager },
        { provide: QueueService, useValue: mockQueueService },
        { provide: MediaContract, useValue: mockMediaService },
      ],
    }).compile();

    service = module.get<PlaybackService>(PlaybackService);
    jest.clearAllMocks();

    mathRandomSpy = jest.spyOn(Math, 'random');
  });

  afterEach(() => {
    mathRandomSpy.mockRestore();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getNextTrack', () => {
    it('returns next segment and updates channel playhead', async () => {
      const channelId = 'chan-1';

      const channel = Object.assign(new Channel(), {
        id: channelId,
        currentSegmentId: null,
      });

      const segment = Object.assign(new MusicSegment(), {
        id: 'seg-1',
        channelId,
        playOrder: 1,
        audioUrl: 'media/song.mp3',
        durationSeconds: 180,
        title: 'Song Title',
        artist: 'Artist Name',
      });

      mockChannelRepo.findOne.mockResolvedValue(channel);
      mockSegmentRepo.findOne.mockResolvedValue(segment);
      mockSegmentRepo.count.mockResolvedValue(5);

      const track = await service.getNextTrack(channelId);

      expect(track.segmentId).toBe('seg-1');
      expect(track.type).toBe('music');
      expect(track.filePath).toBe('media/song.mp3');
      expect(track.durationSeconds).toBe(180);
      expect(channel.currentSegmentId).toBe('seg-1');
      expect(mockEntityManager.flush).toHaveBeenCalled();
    });

    it('triggers bufferAhead when remaining runway is low (< 4)', async () => {
      const channelId = 'chan-1';
      const channel = Object.assign(new Channel(), { id: channelId });
      const segment = Object.assign(new MusicSegment(), {
        id: 'seg-1',
        playOrder: 1,
        durationSeconds: 180,
        audioUrl: 'song.mp3',
      });

      mockChannelRepo.findOne.mockResolvedValue(channel);
      mockSegmentRepo.findOne.mockResolvedValue(segment);
      mockSegmentRepo.count.mockResolvedValue(2);

      await service.getNextTrack(channelId);

      expect(mockQueueService.bufferAhead).toHaveBeenCalledWith(channelId);
    });

    it('returns interim jingle if next talk segment is still generating', async () => {
      const channelId = 'chan-1';
      const channel = Object.assign(new Channel(), { id: channelId });
      const talk = Object.assign(new TalkSegment(), {
        id: 'talk-1',
        playOrder: 1,
        status: 'generating',
      });

      mockChannelRepo.findOne.mockResolvedValue(channel);
      mockSegmentRepo.findOne.mockResolvedValue(talk);

      const track = await service.getNextTrack(channelId);

      expect(track.type).toBe('jingle');
      expect(track.segmentId).toBe('interim-jingle');
    });

    it('prunes segments older than 100 positions behind current playhead', async () => {
      const channelId = 'chan-1';
      const channel = Object.assign(new Channel(), { id: channelId });
      const segment = Object.assign(new MusicSegment(), {
        id: 'seg-105',
        playOrder: 105,
        durationSeconds: 180,
        audioUrl: 'song.mp3',
      });

      mockChannelRepo.findOne.mockResolvedValue(channel);
      mockSegmentRepo.findOne.mockResolvedValue(segment);
      mockSegmentRepo.count.mockResolvedValue(5);

      await service.getNextTrack(channelId);

      expect(mockSegmentRepo.nativeDelete).toHaveBeenCalledWith({
        channel: channelId,
        playOrder: { $lt: 5 },
      });
    });
  });
});
