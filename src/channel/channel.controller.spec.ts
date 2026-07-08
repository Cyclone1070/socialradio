import { Test, TestingModule } from '@nestjs/testing';
import { ChannelController } from './channel.controller';
import { ChannelService } from './channel.service';
import { ChannelBroadcasterService } from './channel-broadcaster.service';
import { ConfigureChannelDto } from './dto/configure-channel.dto';

describe('ChannelController', () => {
  let controller: ChannelController;
  let service: ChannelService;
  let broadcasterService: ChannelBroadcasterService;

  const mockChannelService = {
    getUserChannels: jest.fn(),
    configureChannel: jest.fn(),
    subscribeToSubreddit: jest.fn(),
    unsubscribeFromSubreddit: jest.fn(),
  };

  const mockBroadcasterService = {
    registerClient: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChannelController],
      providers: [
        { provide: ChannelService, useValue: mockChannelService },
        { provide: ChannelBroadcasterService, useValue: mockBroadcasterService },
      ],
    }).compile();

    controller = module.get<ChannelController>(ChannelController);
    service = module.get<ChannelService>(ChannelService);
    broadcasterService = module.get<ChannelBroadcasterService>(ChannelBroadcasterService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getUserChannels', () => {
    it('should return user channels', async () => {
      const channels = [{ id: '1', name: 'Public', type: 'public', ownerId: null }];
      mockChannelService.getUserChannels.mockResolvedValue(channels);

      const req = { user: { id: 'user-1' } };
      const result = await controller.getUserChannels(req);

      expect(mockChannelService.getUserChannels).toHaveBeenCalledWith('user-1');
      expect(result).toEqual(channels);
    });
  });

  describe('configureChannel', () => {
    it('should configure channel and return response', async () => {
      const dto: ConfigureChannelDto = { name: 'My Radio', type: 'private' };
      const channel = { id: 'chan-1', name: 'My Radio', type: 'private', ownerId: 'user-1' };
      mockChannelService.configureChannel.mockResolvedValue(channel);

      const req = { user: { id: 'user-1' } };
      const result = await controller.configureChannel(dto, req);

      expect(mockChannelService.configureChannel).toHaveBeenCalledWith(dto, 'user-1');
      expect(result).toEqual(channel);
    });
  });

  describe('subscribeToSubreddit', () => {
    it('should subscribe subreddit to channel', async () => {
      mockChannelService.subscribeToSubreddit.mockResolvedValue(undefined);

      await controller.subscribeToSubreddit('chan-1', { subredditName: 'AskReddit' });

      expect(mockChannelService.subscribeToSubreddit).toHaveBeenCalledWith('chan-1', 'AskReddit');
    });
  });

  describe('unsubscribeFromSubreddit', () => {
    it('should unsubscribe subreddit from channel', async () => {
      mockChannelService.unsubscribeFromSubreddit.mockResolvedValue(undefined);

      await controller.unsubscribeFromSubreddit('chan-1', 'AskReddit');

      expect(mockChannelService.unsubscribeFromSubreddit).toHaveBeenCalledWith('chan-1', 'AskReddit');
    });
  });

  describe('streamChannel', () => {
    it('should register client response for live streaming', async () => {
      const mockRes = {} as any;
      mockBroadcasterService.registerClient.mockResolvedValue(undefined);

      await controller.streamChannel('chan-1', mockRes);

      expect(mockBroadcasterService.registerClient).toHaveBeenCalledWith('chan-1', mockRes);
    });
  });
});
