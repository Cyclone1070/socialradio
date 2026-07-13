import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HlsGeneratorService } from './hls-generator.service';
import { Channel } from './entities/channel.entity';
import {
  Segment,
  SongSegment,
  TalkSegment,
  AdSegment,
  JingleSegment,
} from './entities/segment.entity';
import { QueueGeneratorService } from './queue-generator.service';

describe('HlsGeneratorService', () => {
  let service: HlsGeneratorService;

  const mockChannelRepo = {
    findOneBy: jest.fn(),
    save: jest.fn(),
  };

  const mockSegmentRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    count: jest.fn(),
  };

  const mockStorageService = {
    createReadStream: jest.fn(),
    write: jest.fn(),
    delete: jest.fn(),
    exists: jest.fn(),
  };

  const mockQueueGen = {
    bufferAhead: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HlsGeneratorService,
        { provide: getRepositoryToken(Channel), useValue: mockChannelRepo },
        { provide: getRepositoryToken(Segment), useValue: mockSegmentRepo },
        { provide: 'StorageService', useValue: mockStorageService },
        { provide: QueueGeneratorService, useValue: mockQueueGen },
      ],
    }).compile();

    service = module.get<HlsGeneratorService>(HlsGeneratorService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateNextChunk', () => {
    it('should generate a 6s chunk and update sliding-window manifest', async () => {
      const channelId = 'chan-123';
      const channel = Object.assign(new Channel(), {
        id: channelId,
        visibility: 'public',
        isPaused: false,
        currentSegmentId: 'seg-1',
        playheadOffsetSeconds: 0,
      });

      const segment = Object.assign(new SongSegment(), {
        id: 'seg-1',
        channelId,
        audioUrl: 'song.mp3',
        durationSeconds: 180,
        playOrder: 1,
        title: 'Song A',
        artist: 'Artist A',
      });

      mockChannelRepo.findOneBy.mockResolvedValue(channel);
      mockSegmentRepo.findOne.mockResolvedValue(segment);

      const mockStream = {
        pipe: jest
          .fn()
          .mockImplementation(
            (dest: { write: (b: Buffer) => void; end: () => void }) => {
              dest.write(Buffer.alloc(160000));
              dest.end();
              return mockStream;
            },
          ),
        on: jest.fn().mockImplementation((event: string, cb: () => void) => {
          if (event === 'end') cb();
          return mockStream;
        }),
      };
      mockStorageService.createReadStream.mockReturnValue(mockStream);
      mockStorageService.exists.mockReturnValue(false); // No manifest exists yet, write a new one

      await service.generateNextChunk(channelId);

      expect(mockStorageService.createReadStream).toHaveBeenCalledWith(
        'song.mp3',
        {
          start: 0,
          end: 159999,
        },
      );
      expect(mockStorageService.write).toHaveBeenCalledWith(
        expect.objectContaining({
          key: expect.stringContaining('chunk_') as unknown,
          content: expect.any(Buffer) as unknown,
          cacheControl: expect.any(String) as unknown,
        }) as unknown,
      );
      expect(mockStorageService.write).toHaveBeenCalledWith(
        expect.objectContaining({
          key: `channels/${channelId}/playlist.m3u8`,
          content: expect.any(String) as unknown,
          cacheControl: expect.any(String) as unknown,
        }) as unknown,
      );
    });

    it('should inject AdSegment fallback if next segment is a generating TalkSegment', async () => {
      const channelId = 'chan-123';
      const channel = Object.assign(new Channel(), {
        id: channelId,
        visibility: 'public',
        isPaused: false,
        currentSegmentId: 'seg-talk',
        playheadOffsetSeconds: 0,
      });

      const segment = Object.assign(new TalkSegment(), {
        id: 'seg-talk',
        channelId,
        audioUrl: null,
        durationSeconds: null,
        playOrder: 2,
        topicId: 'topic-1',
        status: 'generating',
      });

      mockChannelRepo.findOneBy.mockResolvedValue(channel);
      mockSegmentRepo.findOne.mockResolvedValue(segment);
      mockSegmentRepo.find.mockResolvedValue([segment]); // list for playOrder shifting
      mockSegmentRepo.save.mockImplementation((item) =>
        Promise.resolve({ id: 'fallback-ad-id', ...item }),
      );

      await service.generateNextChunk(channelId);

      // Verify that segment shifting and AdSegment insertion occurred
      expect(mockSegmentRepo.save).toHaveBeenCalledWith(expect.any(AdSegment));
      expect(segment.playOrder).toBe(3); // Shifted up by 1
    });
  });

  describe('fastForwardChannel', () => {
    it('should keep playhead position if idleTime is less than remaining segment duration', async () => {
      const channelId = 'chan-123';
      const channel = Object.assign(new Channel(), {
        id: channelId,
        visibility: 'private',
        isPaused: true,
        currentSegmentId: 'seg-1',
        playheadOffsetSeconds: 10,
      });

      const seg1 = Object.assign(new SongSegment(), {
        id: 'seg-1',
        channelId,
        durationSeconds: 180,
        playOrder: 1,
      });

      mockChannelRepo.findOneBy.mockResolvedValue(channel);
      mockSegmentRepo.findOne.mockResolvedValue(seg1);

      // Idle for 100 seconds (remaining = 180 - 10 = 170s. 100 < 170 -> short idle)
      await service.fastForwardChannel(channelId, 100);

      expect(channel.currentSegmentId).toBe('seg-1');
      expect(channel.playheadOffsetSeconds).toBe(10);
      expect(mockChannelRepo.save).toHaveBeenCalledWith(channel);
    });

    it('should jump to the last 10s of the segment if idleTime is greater than or equal to remaining duration (segment > 10s)', async () => {
      const channelId = 'chan-123';
      const channel = Object.assign(new Channel(), {
        id: channelId,
        visibility: 'private',
        isPaused: true,
        currentSegmentId: 'seg-1',
        playheadOffsetSeconds: 10,
      });

      const seg1 = Object.assign(new SongSegment(), {
        id: 'seg-1',
        channelId,
        durationSeconds: 180,
        playOrder: 1,
      });

      mockChannelRepo.findOneBy.mockResolvedValue(channel);
      mockSegmentRepo.findOne.mockResolvedValue(seg1);

      // Idle for 200 seconds (remaining = 170s. 200 >= 170 -> long idle)
      await service.fastForwardChannel(channelId, 200);

      expect(channel.currentSegmentId).toBe('seg-1');
      expect(channel.playheadOffsetSeconds).toBe(170); // 180 - 10 = 170s
      expect(mockChannelRepo.save).toHaveBeenCalledWith(channel);
    });

    it('should jump to offset 0 of the segment if idleTime is greater than or equal to remaining duration and segment duration <= 10s', async () => {
      const channelId = 'chan-123';
      const channel = Object.assign(new Channel(), {
        id: channelId,
        visibility: 'private',
        isPaused: true,
        currentSegmentId: 'seg-2',
        playheadOffsetSeconds: 1,
      });

      const seg2 = Object.assign(new JingleSegment(), {
        id: 'seg-2',
        channelId,
        durationSeconds: 8,
        playOrder: 1,
      });

      mockChannelRepo.findOneBy.mockResolvedValue(channel);
      mockSegmentRepo.findOne.mockResolvedValue(seg2);

      // Idle for 15 seconds (remaining = 7s. 15 >= 7 -> long idle)
      await service.fastForwardChannel(channelId, 15);

      expect(channel.currentSegmentId).toBe('seg-2');
      expect(channel.playheadOffsetSeconds).toBe(0);
      expect(mockChannelRepo.save).toHaveBeenCalledWith(channel);
    });
  });
});
