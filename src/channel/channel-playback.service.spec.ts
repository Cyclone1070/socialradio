import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ChannelPlaybackService } from './channel-playback.service';
import { ChunkerService } from './chunker.service';
import { SegmentContract } from '../domain/contracts';
import { Channel } from './entities/channel.entity';
import { Segment, SongSegment } from './entities/segment.entity';
import { LessThan } from 'typeorm';

describe('ChannelPlaybackService', () => {
  let service: ChannelPlaybackService;
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

  const mockChunker = {
    getManifestUri: jest
      .fn()
      .mockImplementation((segmentId, idx) => `chunks/${segmentId}_${idx}.mp3`),
    deleteSegmentChunks: jest.fn(),
  };

  const mockSegmentGenerator = {
    bufferAhead: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChannelPlaybackService,
        { provide: getRepositoryToken(Channel), useValue: mockChannelRepo },
        { provide: getRepositoryToken(Segment), useValue: mockSegmentRepo },
        { provide: ChunkerService, useValue: mockChunker },
        { provide: SegmentContract, useValue: mockSegmentGenerator },
      ],
    }).compile();

    service = module.get<ChannelPlaybackService>(ChannelPlaybackService);
    jest.clearAllMocks();

    // Spy on Math.random
    mathRandomSpy = jest.spyOn(Math, 'random');
  });

  afterEach(() => {
    mathRandomSpy.mockRestore();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getPlaylistManifest', () => {
    it('calculates playhead offset statelessly using currentSegmentStartedAt and media sequence using createdAt', async () => {
      const channelId = 'chan-1';
      const createdAt = new Date('2026-08-12T10:00:00.000Z');
      const now = new Date('2026-08-12T10:02:17.000Z'); // 137s after createdAt
      const currentSegmentStartedAt = new Date('2026-08-12T10:02:00.000Z'); // 17s after startedAt

      const channel = Object.assign(new Channel(), {
        id: channelId,
        visibility: 'private',
        currentSegmentId: 'seg-1',
        currentSegmentStartedAt,
        createdAt,
      });

      const segment = Object.assign(new SongSegment(), {
        id: 'seg-1',
        durationSeconds: 180,
        playOrder: 1,
      });

      mockChannelRepo.findOneBy.mockResolvedValue(channel);
      mockSegmentRepo.findOne.mockResolvedValue(segment);
      mockSegmentRepo.count.mockResolvedValue(5);

      const manifest = await service.getPlaylistManifest(channelId, now);

      // media sequence = Math.floor(137 / 10) = 13
      expect(manifest).toContain('#EXTM3U');
      expect(manifest).toContain('#EXT-X-TARGETDURATION:10');
      expect(manifest).toContain('#EXT-X-MEDIA-SEQUENCE:13');
      // offset 17s -> chunk_1 with start offset 7.0s
      expect(manifest).toContain('#EXT-X-START:TIME=7.0');
      expect(manifest).toContain('#EXTINF:10.0,\nchunks/seg-1_1.mp3');
      // Active intra-segment polling does NOT call update/save
      expect(mockChannelRepo.save).not.toHaveBeenCalled();
      expect(mockChannelRepo.update).not.toHaveBeenCalled();
    });

    it('inserts #EXT-X-DISCONTINUITY and appends next segment chunk at segment boundaries', async () => {
      const channelId = 'chan-1';
      const createdAt = new Date('2026-08-12T10:00:00.000Z');
      const now = new Date('2026-08-12T10:02:58.000Z'); // 178s after startedAt (2s remaining in seg-1)
      const currentSegmentStartedAt = new Date('2026-08-12T10:00:00.000Z');

      const channel = Object.assign(new Channel(), {
        id: channelId,
        visibility: 'private',
        currentSegmentId: 'seg-1',
        currentSegmentStartedAt,
        createdAt,
      });

      const segment1 = Object.assign(new SongSegment(), {
        id: 'seg-1',
        durationSeconds: 180,
        playOrder: 1,
      });

      const segment2 = Object.assign(new SongSegment(), {
        id: 'seg-2',
        durationSeconds: 180,
        playOrder: 2,
      });

      mockChannelRepo.findOneBy.mockResolvedValue(channel);
      mockSegmentRepo.findOne
        .mockResolvedValueOnce(segment1)
        .mockResolvedValueOnce(segment2);
      mockSegmentRepo.count.mockResolvedValue(5);

      const manifest = await service.getPlaylistManifest(channelId, now);

      expect(manifest).toContain('chunks/seg-1_17.mp3');
      expect(manifest).toContain('#EXT-X-DISCONTINUITY');
      expect(manifest).toContain('chunks/seg-2_0.mp3');
    });

    it('prunes segments older than 100 positions behind current playhead and deletes CDN chunks from MinIO S3', async () => {
      const channelId = 'chan-1';
      const now = new Date('2026-08-12T10:05:00.000Z');
      const currentSegmentStartedAt = new Date('2026-08-12T10:02:00.000Z');

      const channel = Object.assign(new Channel(), {
        id: channelId,
        currentSegmentId: 'seg-105',
        currentSegmentStartedAt,
        createdAt: new Date('2026-08-12T08:00:00.000Z'),
      });

      const activeSegment = Object.assign(new SongSegment(), {
        id: 'seg-105',
        durationSeconds: 180,
        playOrder: 105,
      });

      const expiredSegment1 = Object.assign(new SongSegment(), {
        id: 'seg-1',
        durationSeconds: 180,
        playOrder: 1,
      });
      const expiredSegment2 = Object.assign(new SongSegment(), {
        id: 'seg-2',
        durationSeconds: 180,
        playOrder: 2,
      });

      mockChannelRepo.findOneBy.mockResolvedValue(channel);
      mockSegmentRepo.findOne.mockResolvedValue(activeSegment);
      mockSegmentRepo.find.mockResolvedValue([
        expiredSegment1,
        expiredSegment2,
      ]);

      await service.getPlaylistManifest(channelId, now);

      expect(mockSegmentRepo.find).toHaveBeenCalledWith({
        where: {
          channelId,
          playOrder: LessThan(5), // 105 - 100 = 5
        },
      });
      expect(mockChunker.deleteSegmentChunks).toHaveBeenCalledWith(
        channelId,
        'seg-1',
        180,
      );
      expect(mockChunker.deleteSegmentChunks).toHaveBeenCalledWith(
        channelId,
        'seg-2',
        180,
      );
      expect(mockSegmentRepo.delete).toHaveBeenCalledWith({
        channelId,
        playOrder: LessThan(5),
      });
    });

    it('triggers fastForwardChannel stinger when overdue time exceeds 120s', async () => {
      const channelId = 'chan-1';
      const now = new Date('2026-08-12T10:10:00.000Z'); // 600s after startedAt (duration = 180s, overdue = 420s > 120s)
      const currentSegmentStartedAt = new Date('2026-08-12T10:00:00.000Z');

      const channel = Object.assign(new Channel(), {
        id: channelId,
        currentSegmentId: 'seg-1',
        currentSegmentStartedAt,
        createdAt: new Date('2026-08-12T08:00:00.000Z'),
      });

      const segment = Object.assign(new SongSegment(), {
        id: 'seg-1',
        durationSeconds: 180,
        playOrder: 1,
      });

      mockChannelRepo.findOneBy.mockResolvedValue(channel);
      mockSegmentRepo.findOne.mockResolvedValue(segment);
      mockSegmentRepo.count.mockResolvedValue(5);
      mathRandomSpy.mockReturnValue(0.5); // wrap duration = 15s

      await service.getPlaylistManifest(channelId, now);

      // startedAt updated via optimistic update to now - (180s - 15s) = now - 165s
      expect(mockChannelRepo.update).toHaveBeenCalledWith(
        { id: channelId, currentSegmentStartedAt },
        {
          currentSegmentId: 'seg-1',
          currentSegmentStartedAt: new Date(now.getTime() - 165000),
        },
      );
    });
  });
});
