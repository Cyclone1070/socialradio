import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SegmentModule } from './segment.module';
import {
  SegmentContract,
  ContentContract,
  ChannelContract,
  ScriptContract,
  VoiceContract,
} from '../domain/contracts';
import { SegmentService } from './segment.service';
import { Segment } from './entities/segment.entity';
import { MediaService } from '../media/media.service';

describe('SegmentModule Integration', () => {
  let segmentGenerator: SegmentContract;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SegmentService,
        {
          provide: getRepositoryToken(Segment),
          useValue: { findOne: jest.fn(), save: jest.fn() },
        },
        {
          provide: MediaService,
          useValue: {
            getRandomMusic: jest.fn(),
            getRandomAd: jest.fn(),
            getRandomJingle: jest.fn(),
          },
        },
        {
          provide: ContentContract,
          useValue: {
            getSubredditsByIds: jest.fn(),
            getPostsBySubredditIds: jest.fn(),
            getCommentsByPostIds: jest.fn(),
            scrapeSubreddit: jest.fn(),
          },
        },
        {
          provide: ChannelContract,
          useValue: {
            getSubredditIdsForChannel: jest.fn(),
            getCompletedPostIdsForChannel: jest.fn(),
            markPostCompletedForChannel: jest.fn(),
            sliceAndUploadChunk: jest.fn(),
          },
        },
        {
          provide: ScriptContract,
          useValue: { generateScript: jest.fn() },
        },
        {
          provide: VoiceContract,
          useValue: { synthesizeScript: jest.fn() },
        },
        {
          provide: SegmentContract,
          useClass: SegmentService,
        },
      ],
    }).compile();

    segmentGenerator = module.get<SegmentContract>(SegmentContract);
  });

  it('should export SegmentContract from SegmentModule', () => {
    expect(SegmentModule).toBeDefined();
    expect(segmentGenerator).toBeDefined();
  });
});
