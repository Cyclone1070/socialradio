import { Test, TestingModule } from '@nestjs/testing';
import { AdminChannelController } from './admin-channel.controller';
import { QueueService } from './queue.service';

describe('AdminChannelController', () => {
  let controller: AdminChannelController;

  const mockQueueService = {
    findPendingTopicSegment: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminChannelController],
      providers: [
        {
          provide: QueueService,
          useValue: mockQueueService,
        },
      ],
    }).compile();

    controller = module.get<AdminChannelController>(AdminChannelController);
    jest.clearAllMocks();
  });

  it('should return pending topics for admin inspection', async () => {
    const topic = { id: 'top-1', posts: [] };
    mockQueueService.findPendingTopicSegment.mockResolvedValue(topic);

    const result = await controller.getTopics('chan-1');

    expect(mockQueueService.findPendingTopicSegment).toHaveBeenCalledWith(
      'chan-1',
    );
    expect(result).toEqual(topic);
  });
});
