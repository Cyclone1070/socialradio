import { Test, TestingModule } from '@nestjs/testing';
import { AdminSegmentController } from './admin-segment.controller';
import { SegmentService } from './segment.service';
import { RolesGuard } from '../user/roles.guard';

describe('AdminSegmentController', () => {
  let controller: AdminSegmentController;
  let segmentService: Partial<SegmentService>;

  beforeEach(async () => {
    segmentService = {
      findPendingTopicSegment: jest.fn().mockResolvedValue({ id: 'topic-1' }),
    };

    const mockGuard = { canActivate: jest.fn(() => true) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminSegmentController],
      providers: [
        {
          provide: SegmentService,
          useValue: segmentService,
        },
      ],
    })
      .overrideGuard(RolesGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get<AdminSegmentController>(AdminSegmentController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return pending topic segment for channel', async () => {
    const result = await controller.getTopics('chan-123');
    expect(segmentService.findPendingTopicSegment).toHaveBeenCalledWith(
      'chan-123',
    );
    expect(result).toEqual({ id: 'topic-1' });
  });
});
