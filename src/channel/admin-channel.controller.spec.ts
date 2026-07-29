import { Test, TestingModule } from '@nestjs/testing';
import { AdminChannelController } from './admin-channel.controller';
import { QueueGeneratorService } from './queue-generator.service';
import { RolesGuard } from '../auth/roles.guard';

describe('AdminChannelController', () => {
  let controller: AdminChannelController;
  let queueGeneratorService: Partial<QueueGeneratorService>;

  beforeEach(async () => {
    queueGeneratorService = {
      findPendingTopicSegment: jest.fn().mockResolvedValue({ id: 'topic-1' }),
    };

    const mockGuard = { canActivate: jest.fn(() => true) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminChannelController],
      providers: [
        {
          provide: QueueGeneratorService,
          useValue: queueGeneratorService,
        },
      ],
    })
      .overrideGuard(RolesGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get<AdminChannelController>(AdminChannelController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return pending topic segment for admin channel', async () => {
    const result = await controller.getTopics('chan-123');
    expect(queueGeneratorService.findPendingTopicSegment).toHaveBeenCalledWith(
      'chan-123',
    );
    expect(result).toEqual({ id: 'topic-1' });
  });
});
