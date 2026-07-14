import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ChannelPlaybackService } from './channel-playback.service';
import { ChunkerService } from './chunker.service';
import { QueueGeneratorService } from './queue-generator.service';
import { Channel } from './entities/channel.entity';
import { Segment, SongSegment } from './entities/segment.entity';

describe('ChannelPlaybackService', () => {
  let service: ChannelPlaybackService;
  let mathRandomSpy: jest.SpyInstance;

  const mockChannelRepo = {
    findOneBy: jest.fn(),
    save: jest.fn(),
  };

  const mockSegmentRepo = {
    findOne: jest.fn(),
    count: jest.fn(),
  };

  const mockChunker = {
    getManifestUri: jest
      .fn()
      .mockImplementation((segmentId, idx) => `chunks/${segmentId}_${idx}.mp3`),
  };

  const mockQueueGen = {
    bufferAhead: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChannelPlaybackService,
        { provide: getRepositoryToken(Channel), useValue: mockChannelRepo },
        { provide: getRepositoryToken(Segment), useValue: mockSegmentRepo },
        { provide: ChunkerService, useValue: mockChunker },
        { provide: QueueGeneratorService, useValue: mockQueueGen },
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
    it('should advance playhead and return manifest pointing to pre-chunked files', async () => {
      const channelId = 'chan-1';
      const lastRequestedAt = new Date(Date.now() - 5000);
      const channel = Object.assign(new Channel(), {
        id: channelId,
        visibility: 'private',
        currentSegmentId: 'seg-1',
        playheadOffsetSeconds: 12,
        lastRequestedAt,
      });

      const segment = Object.assign(new SongSegment(), {
        id: 'seg-1',
        durationSeconds: 180,
        playOrder: 1,
      });

      mockChannelRepo.findOneBy.mockResolvedValue(channel);
      mockSegmentRepo.findOne.mockResolvedValue(segment);
      mockSegmentRepo.count.mockResolvedValue(5);
      mockChannelRepo.save.mockResolvedValue(channel);

      const manifest = await service.getPlaylistManifest(channelId);

      expect(channel.playheadOffsetSeconds).toBeCloseTo(17, 1);
      expect(manifest).toContain('#EXTM3U');
      expect(manifest).toContain('#EXT-X-TARGETDURATION:10');
      expect(manifest).toContain('#EXT-X-MEDIA-SEQUENCE:2');
      expect(manifest).toContain('#EXT-X-START:TIME=7.0');
      expect(manifest).toContain('#EXTINF:10.0,\nchunks/seg-1_1.mp3');
    });

    it('should trigger fastForwardChannel (and wrap segment) if idle time is greater than 120s', async () => {
      const channelId = 'chan-1';
      // 200 seconds ago (idle)
      const lastRequestedAt = new Date(Date.now() - 200000);
      const channel = Object.assign(new Channel(), {
        id: channelId,
        visibility: 'private',
        currentSegmentId: 'seg-1',
        playheadOffsetSeconds: 12,
        lastRequestedAt,
      });

      const segment = Object.assign(new SongSegment(), {
        id: 'seg-1',
        durationSeconds: 180,
        playOrder: 1,
      });

      mockChannelRepo.findOneBy.mockResolvedValue(channel);
      mockSegmentRepo.findOne.mockResolvedValue(segment);
      mockSegmentRepo.count.mockResolvedValue(5);
      mockChannelRepo.save.mockResolvedValue(channel);

      // Mock random to 0.5. Wrap duration = floor(0.5 * 11) + 10 = 15 seconds.
      // Expected playhead offset = 180 - 15 = 165 seconds.
      mathRandomSpy.mockReturnValue(0.5);

      await service.getPlaylistManifest(channelId);

      expect(channel.playheadOffsetSeconds).toBe(165);
    });

    it('should NOT trigger fastForwardChannel (and advance playhead naturally) if idle time is less than 120s', async () => {
      const channelId = 'chan-1';
      // 60 seconds ago (< 120s)
      const lastRequestedAt = new Date(Date.now() - 60000);
      const channel = Object.assign(new Channel(), {
        id: channelId,
        visibility: 'private',
        currentSegmentId: 'seg-1',
        playheadOffsetSeconds: 12,
        lastRequestedAt,
      });

      const segment = Object.assign(new SongSegment(), {
        id: 'seg-1',
        durationSeconds: 180,
        playOrder: 1,
      });

      mockChannelRepo.findOneBy.mockResolvedValue(channel);
      mockSegmentRepo.findOne.mockResolvedValue(segment);
      mockSegmentRepo.count.mockResolvedValue(5);
      mockChannelRepo.save.mockResolvedValue(channel);

      await service.getPlaylistManifest(channelId);

      // 12s offset + 60s elapsed = 72s offset
      expect(channel.playheadOffsetSeconds).toBeCloseTo(72, 1);
    });

    it('should trigger bufferAhead in background if remaining count in queue is low (< 3)', async () => {
      const channelId = 'chan-1';
      const lastRequestedAt = new Date(Date.now() - 5000);
      const channel = Object.assign(new Channel(), {
        id: channelId,
        visibility: 'private',
        currentSegmentId: 'seg-1',
        playheadOffsetSeconds: 12,
        lastRequestedAt,
      });

      const segment = Object.assign(new SongSegment(), {
        id: 'seg-1',
        durationSeconds: 180,
        playOrder: 1,
      });

      mockChannelRepo.findOneBy.mockResolvedValue(channel);
      mockSegmentRepo.findOne.mockResolvedValue(segment);
      mockSegmentRepo.count.mockResolvedValue(2); // low remaining count
      mockChannelRepo.save.mockResolvedValue(channel);
      mockQueueGen.bufferAhead.mockResolvedValue(undefined);

      await service.getPlaylistManifest(channelId);

      expect(mockQueueGen.bufferAhead).toHaveBeenCalledWith(channelId);
    });

    it('should transition to next segment if playhead offset exceeds segment duration', async () => {
      const channelId = 'chan-1';
      const lastRequestedAt = new Date(Date.now() - 5000); // 5s elapsed
      const channel = Object.assign(new Channel(), {
        id: channelId,
        visibility: 'private',
        currentSegmentId: 'seg-1',
        playheadOffsetSeconds: 178, // only 2s left in segment (duration 180)
        lastRequestedAt,
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
        .mockResolvedValueOnce(segment1) // currentSegmentId fetch
        .mockResolvedValueOnce(segment2); // next segment playOrder + 1 fetch
      mockSegmentRepo.count.mockResolvedValue(5);
      mockChannelRepo.save.mockResolvedValue(channel);

      const manifest = await service.getPlaylistManifest(channelId);

      // 178s + 5s = 183s. 183s - 180s = 3s offset in segment2
      expect(channel.currentSegmentId).toBe('seg-2');
      expect(channel.playheadOffsetSeconds).toBeCloseTo(3, 1);
      expect(manifest).toContain('chunks/seg-2_0.mp3');
      expect(manifest).toContain('#EXT-X-START:TIME=3.0');
    });
  });

  describe('fastForwardChannel', () => {
    it('should NOT advance playhead if idleTime is less than remaining segment duration', async () => {
      const channelId = 'chan-123';
      const channel = Object.assign(new Channel(), {
        id: channelId,
        currentSegmentId: 'seg-1',
        playheadOffsetSeconds: 10,
      });

      const segment = Object.assign(new SongSegment(), {
        id: 'seg-1',
        durationSeconds: 180,
      });

      mockChannelRepo.findOneBy.mockResolvedValue(channel);
      mockSegmentRepo.findOne.mockResolvedValue(segment);

      await service.fastForwardChannel(channelId, 100);

      expect(channel.playheadOffsetSeconds).toBe(10);
      expect(mockChannelRepo.save).toHaveBeenCalledWith(channel);
    });

    it('should jump to a randomized wrap duration between 10s and 20s if Math.random is mocked', async () => {
      const channelId = 'chan-123';
      const channel = Object.assign(new Channel(), {
        id: channelId,
        currentSegmentId: 'seg-1',
        playheadOffsetSeconds: 10,
      });

      const segment = Object.assign(new SongSegment(), {
        id: 'seg-1',
        durationSeconds: 180,
      });

      mockChannelRepo.findOneBy.mockResolvedValue(channel);
      mockSegmentRepo.findOne.mockResolvedValue(segment);

      // Mock random to 0.5. Wrap duration = floor(0.5 * 11) + 10 = 5 + 10 = 15 seconds.
      // Expected playhead offset = 180 - 15 = 165 seconds.
      mathRandomSpy.mockReturnValue(0.5);

      await service.fastForwardChannel(channelId, 200);

      expect(channel.playheadOffsetSeconds).toBe(165); // This will FAIL under current 10s logic! (Should be 170)
      expect(mockChannelRepo.save).toHaveBeenCalledWith(channel);
    });

    it('should skip the segment entirely and transition to the next segment if duration is 20 seconds or shorter', async () => {
      const channelId = 'chan-123';
      const channel = Object.assign(new Channel(), {
        id: channelId,
        currentSegmentId: 'seg-1',
        playheadOffsetSeconds: 1,
      });

      const segment1 = Object.assign(new SongSegment(), {
        id: 'seg-1',
        playOrder: 1,
        durationSeconds: 18, // <= 20s
      });

      const segment2 = Object.assign(new SongSegment(), {
        id: 'seg-2',
        playOrder: 2,
        durationSeconds: 180,
      });

      mockChannelRepo.findOneBy.mockResolvedValue(channel);
      mockSegmentRepo.findOne
        .mockResolvedValueOnce(segment1) // currentSegmentId fetch
        .mockResolvedValueOnce(segment2); // next segment playOrder + 1 fetch

      await service.fastForwardChannel(channelId, 30); // 30s idle > 17s remaining

      expect(channel.currentSegmentId).toBe('seg-2');
      expect(channel.playheadOffsetSeconds).toBe(0);
      expect(mockChannelRepo.save).toHaveBeenCalledWith(channel);
    });
  });
});
