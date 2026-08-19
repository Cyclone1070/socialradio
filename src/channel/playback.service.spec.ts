import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PlaybackService } from './playback.service';
import { QueueService } from './queue.service';
import { MediaService } from '../media/media.service';
import { Channel } from './entities/channel.entity';
import { Segment, SongSegment, TalkSegment } from './entities/segment.entity';
import { LessThan } from 'typeorm';

describe('PlaybackService', () => {
  let service: PlaybackService;
  let mathRandomSpy: jest.SpyInstance;

  const mockChannelRepo = {
    findOneBy: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  };

  const mockSegmentRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    count: jest.fn(),
    delete: jest.fn(),
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
        { provide: getRepositoryToken(Channel), useValue: mockChannelRepo },
        { provide: getRepositoryToken(Segment), useValue: mockSegmentRepo },
        { provide: QueueService, useValue: mockQueueService },
        { provide: MediaService, useValue: mockMediaService },
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

      const segment = Object.assign(new SongSegment(), {
        id: 'seg-1',
        channelId,
        playOrder: 1,
        audioUrl: 'media/song.mp3',
        durationSeconds: 180,
        title: 'Song Title',
        artist: 'Artist Name',
      });

      mockChannelRepo.findOneBy.mockResolvedValue(channel);
      mockSegmentRepo.findOne.mockResolvedValue(segment);
      mockSegmentRepo.count.mockResolvedValue(5);

      const track = await service.getNextTrack(channelId);

      expect(track.segmentId).toBe('seg-1');
      expect(track.type).toBe('song');
      expect(track.filePath).toBe('media/song.mp3');
      expect(track.durationSeconds).toBe(180);
      expect(mockChannelRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          currentSegmentId: 'seg-1',
        }),
      );
    });

    it('triggers bufferAhead when remaining runway is low (< 4)', async () => {
      const channelId = 'chan-1';
      const channel = Object.assign(new Channel(), { id: channelId });
      const segment = Object.assign(new SongSegment(), {
        id: 'seg-1',
        playOrder: 1,
        durationSeconds: 180,
        audioUrl: 'song.mp3',
      });

      mockChannelRepo.findOneBy.mockResolvedValue(channel);
      mockSegmentRepo.findOne.mockResolvedValue(segment);
      mockSegmentRepo.count.mockResolvedValue(2); // Runway < 4

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

      mockChannelRepo.findOneBy.mockResolvedValue(channel);
      mockSegmentRepo.findOne.mockResolvedValue(talk);

      const track = await service.getNextTrack(channelId);

      expect(track.type).toBe('jingle');
      expect(track.segmentId).toBe('interim-jingle');
    });

    it('prunes segments older than 100 positions behind current playhead', async () => {
      const channelId = 'chan-1';
      const channel = Object.assign(new Channel(), { id: channelId });
      const segment = Object.assign(new SongSegment(), {
        id: 'seg-105',
        playOrder: 105,
        durationSeconds: 180,
        audioUrl: 'song.mp3',
      });

      mockChannelRepo.findOneBy.mockResolvedValue(channel);
      mockSegmentRepo.findOne.mockResolvedValue(segment);
      mockSegmentRepo.count.mockResolvedValue(5);

      await service.getNextTrack(channelId);

      expect(mockSegmentRepo.delete).toHaveBeenCalledWith({
        channelId,
        playOrder: LessThan(5),
      });
    });
  });
});
