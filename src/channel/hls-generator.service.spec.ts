import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HlsGeneratorService } from './hls-generator.service';
import { Channel } from './entities/channel.entity';
import { Segment, SongSegment } from './entities/segment.entity';

describe('HlsGeneratorService', () => {
  let service: HlsGeneratorService;

  const mockChannelRepo = {
    findOneBy: jest.fn(),
    save: jest.fn(),
  };

  const mockSegmentRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
  };

  const mockStorageService = {
    read: jest.fn(),
    write: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HlsGeneratorService,
        { provide: getRepositoryToken(Channel), useValue: mockChannelRepo },
        { provide: getRepositoryToken(Segment), useValue: mockSegmentRepo },
        { provide: 'StorageService', useValue: mockStorageService },
      ],
    }).compile();

    service = module.get<HlsGeneratorService>(HlsGeneratorService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sliceAndUpload', () => {
    it('should slice file buffer into 10s chunks and write to storage', async () => {
      const channelId = 'chan-123';
      const segmentId = 'seg-456';
      const sourceFilePath = 'audio.mp3';

      // 360,000 bytes = two 160KB chunks and one 40KB chunk
      const mockBuffer = Buffer.alloc(360000);
      mockStorageService.read.mockResolvedValue(mockBuffer);
      mockStorageService.write.mockResolvedValue(undefined);

      const totalChunks = await service.sliceAndUpload(
        channelId,
        segmentId,
        sourceFilePath,
      );

      expect(totalChunks).toBe(3);
      expect(mockStorageService.read).toHaveBeenCalledWith(sourceFilePath);

      // Verify the three chunks
      expect(mockStorageService.write).toHaveBeenNthCalledWith(1, {
        key: `channels/${channelId}/chunks/${segmentId}_0.mp3`,
        content: mockBuffer.subarray(0, 160000),
        contentType: 'audio/mpeg',
        cacheControl: 'public, max-age=31536000, immutable',
      });

      expect(mockStorageService.write).toHaveBeenNthCalledWith(2, {
        key: `channels/${channelId}/chunks/${segmentId}_1.mp3`,
        content: mockBuffer.subarray(160000, 320000),
        contentType: 'audio/mpeg',
        cacheControl: 'public, max-age=31536000, immutable',
      });

      expect(mockStorageService.write).toHaveBeenNthCalledWith(3, {
        key: `channels/${channelId}/chunks/${segmentId}_2.mp3`,
        content: mockBuffer.subarray(320000, 360000),
        contentType: 'audio/mpeg',
        cacheControl: 'public, max-age=31536000, immutable',
      });
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

      await service.fastForwardChannel(channelId, 100); // 100s idle < 170s remaining

      expect(channel.playheadOffsetSeconds).toBe(10); // Unchanged
      expect(mockChannelRepo.save).toHaveBeenCalledWith(channel);
    });

    it('should jump to the last 10 seconds if idleTime is greater than remaining segment duration', async () => {
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

      await service.fastForwardChannel(channelId, 200); // 200s idle >= 170s remaining

      expect(channel.playheadOffsetSeconds).toBe(170); // 180 - 10
      expect(mockChannelRepo.save).toHaveBeenCalledWith(channel);
    });

    it('should jump to 0 seconds if the segment duration is 10 seconds or shorter', async () => {
      const channelId = 'chan-123';
      const channel = Object.assign(new Channel(), {
        id: channelId,
        currentSegmentId: 'seg-1',
        playheadOffsetSeconds: 1,
      });

      const segment = Object.assign(new SongSegment(), {
        id: 'seg-1',
        durationSeconds: 8, // <= 10s
      });

      mockChannelRepo.findOneBy.mockResolvedValue(channel);
      mockSegmentRepo.findOne.mockResolvedValue(segment);

      await service.fastForwardChannel(channelId, 15); // 15s idle >= 7s remaining

      expect(channel.playheadOffsetSeconds).toBe(0);
      expect(mockChannelRepo.save).toHaveBeenCalledWith(channel);
    });
  });
});
