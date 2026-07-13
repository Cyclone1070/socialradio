import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ChannelBroadcasterService } from './channel-broadcaster.service';
import { HlsGeneratorService } from './hls-generator.service';
import { Channel } from './entities/channel.entity';

describe('ChannelBroadcasterService', () => {
  let service: ChannelBroadcasterService;

  const mockChannelRepo = {
    find: jest.fn(),
    findOneBy: jest.fn(),
    save: jest.fn(),
  };

  const mockHlsGen = {
    generateNextChunk: jest.fn(),
    fastForwardChannel: jest.fn(),
  };

  const mockStorageService = {
    exists: jest.fn(),
    read: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChannelBroadcasterService,
        { provide: getRepositoryToken(Channel), useValue: mockChannelRepo },
        { provide: HlsGeneratorService, useValue: mockHlsGen },
        { provide: 'StorageService', useValue: mockStorageService },
      ],
    }).compile();

    service = module.get<ChannelBroadcasterService>(ChannelBroadcasterService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('tickActiveChannels', () => {
    it('should tick active and public channels, and auto-pause idle ones', async () => {
      const activeChannel = Object.assign(new Channel(), {
        id: 'chan-1',
        visibility: 'private',
        isPaused: false,
        lastRequestedAt: new Date(Date.now() - 5000), // active within 25s
      });
      const idleChannel = Object.assign(new Channel(), {
        id: 'chan-2',
        visibility: 'private',
        isPaused: false,
        lastRequestedAt: new Date(Date.now() - 40000), // idle (> 25s)
      });
      const publicChannel = Object.assign(new Channel(), {
        id: 'chan-3',
        visibility: 'public',
        isPaused: false,
        lastRequestedAt: null, // public is always active
      });

      mockChannelRepo.find.mockResolvedValue([
        activeChannel,
        idleChannel,
        publicChannel,
      ]);

      await service.tickActiveChannels();

      expect(mockHlsGen.generateNextChunk).toHaveBeenCalledWith('chan-1');
      expect(mockHlsGen.generateNextChunk).toHaveBeenCalledWith('chan-3');
      expect(mockHlsGen.generateNextChunk).not.toHaveBeenCalledWith('chan-2');

      expect(idleChannel.isPaused).toBe(true);
      expect(mockChannelRepo.save).toHaveBeenCalledWith(idleChannel);
    });
  });

  describe('getPlaylistManifest', () => {
    it('should resume private channel, fast forward if paused, and return manifest', async () => {
      const channelId = 'chan-1';
      const lastRequestedAt = new Date(Date.now() - 60000); // 1 min ago
      const channel = Object.assign(new Channel(), {
        id: channelId,
        visibility: 'private',
        isPaused: true,
        lastRequestedAt,
      });

      mockChannelRepo.findOneBy.mockResolvedValue(channel);
      mockStorageService.exists.mockReturnValue(true);
      mockStorageService.read.mockResolvedValue(
        Buffer.from('#EXTM3U\n#EXT-X-TARGETDURATION:6'),
      );

      const result = await service.getPlaylistManifest(channelId);

      expect(mockHlsGen.fastForwardChannel).toHaveBeenCalledWith(channelId, 60);
      expect(channel.isPaused).toBe(false);
      expect(result).toContain('#EXT-X-TARGETDURATION:6');
    });
  });
});
