import { Test, TestingModule } from '@nestjs/testing';
import { ChunkerService } from './chunker.service';

describe('ChunkerService', () => {
  let service: ChunkerService;

  const mockStorageService = {
    read: jest.fn(),
    write: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChunkerService,
        { provide: 'StorageService', useValue: mockStorageService },
      ],
    }).compile();

    service = module.get<ChunkerService>(ChunkerService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getStorageKey', () => {
    it('should generate the correct deterministic R2 key', () => {
      const key = service.getStorageKey('chan-1', 'seg-2', 5);
      expect(key).toBe('channels/chan-1/chunks/seg-2_5.mp3');
    });
  });

  describe('getManifestUri', () => {
    it('should generate the correct dynamic manifest URL path', () => {
      const path = service.getManifestUri('seg-2', 5);
      expect(path).toBe('chunks/seg-2_5.mp3');
    });
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
});
