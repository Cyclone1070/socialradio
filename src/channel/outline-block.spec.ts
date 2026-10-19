import { QueueService } from './queue.service';
import { Channel } from './entities/channel.entity';
import { ChannelSchema } from '../infrastructure/database/schemas/channel.schema';

const OUTLINE = '## STEP 1: COLD OPEN\n- hook';

/**
 * A self-contained harness: the run is the only thing under test here, so every
 * dependency is a plain object rather than a Nest module full of shared state.
 */
function build(options: {
  tail: { playOrder: number; type: string; outline: string | null } | null;
}) {
  const channel = Object.assign(new Channel(), {
    id: 'chan-1',
    subreddits: {
      getItems: () => [
        {
          id: 'sub-1',
          name: 'sub1',
          lastScrapedAt: new Date(),
          createdAt: new Date(),
        },
      ],
    },
    completedPosts: { getItems: () => [], add: jest.fn(), remove: jest.fn() },
  });

  const channelRepo = {
    findOne: jest.fn().mockResolvedValue(channel),
    nativeUpdate: jest.fn().mockResolvedValue(1),
    find: jest.fn().mockResolvedValue([channel]),
  };
  Object.defineProperty(channel, 'bufferClaimId', {
    configurable: true,
    get: () =>
      (
        channelRepo.nativeUpdate.mock.calls[0] as
          [unknown, { bufferClaimId?: string }] | undefined
      )?.[1]?.bufferClaimId ?? null,
  });

  // The tail lookup passes an orderBy; the runway lookup does not.
  const tail: {
    playOrder: number;
    type: string;
    outline: string | null;
  } | null = options.tail;

  const segmentRepo = {
    findOne: jest.fn((_where: unknown, opts?: { orderBy?: unknown }) =>
      Promise.resolve(opts?.orderBy ? tail : null),
    ),
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  };

  interface MockEm {
    persist: jest.Mock;
    flush: jest.Mock;
    getReference: jest.Mock;
    getRepository: jest.Mock;
    transactional: jest.Mock;
    fork?: jest.Mock;
  }

  const em: MockEm = {
    persist: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    getReference: jest.fn((_cls: unknown, id: string) => ({ id })),
    getRepository: jest.fn((cls: unknown) =>
      cls === ChannelSchema ? channelRepo : segmentRepo,
    ),
    transactional: jest.fn(<T>(cb: (em: unknown) => Promise<T>) => cb(em)),
  };
  em.fork = jest.fn().mockReturnValue(em);

  const media = {
    getRandomMusic: jest.fn().mockResolvedValue({
      filePath: 'music/song.mp3',
      durationSeconds: 180,
      title: 'Song',
      artist: 'Artist',
    }),
    getRandomJingle: jest.fn(),
    getRandomLiner: jest.fn().mockResolvedValue({
      filePath: 'liners/back-01.mp3',
      durationSeconds: 4,
      text: 'We will be right back.',
    }),
  };

  const content = {
    getSubredditsByIds: jest.fn().mockResolvedValue([
      {
        id: 'sub-1',
        name: 'sub1',
        lastScrapedAt: new Date(),
        createdAt: new Date(),
      },
    ]),
    getPostsBySubredditIds: jest.fn().mockResolvedValue([
      {
        id: 'post-1',
        subredditId: 'sub-1',
        title: 'Topic Alpha',
        selftext: 'Body',
        ups: 10,
      },
    ]),
    getCommentsByPostIds: jest.fn().mockResolvedValue([]),
    scrapeSubreddit: jest.fn().mockResolvedValue(undefined),
    getPostData: jest.fn(),
    getSubredditByName: jest.fn(),
  };

  const script = {
    generateScript: jest.fn().mockResolvedValue({
      postId: 'post-1',
      turns: [{ speaker: 'Dave', text: 'hello' }],
      outline: OUTLINE,
    }),
  };

  const voice = {
    synthesizeScript: jest.fn().mockResolvedValue({
      filePath: 'audio/talk.mp3',
      durationSeconds: 900,
      postIds: ['post-1'],
    }),
  };

  const service = new QueueService(
    channelRepo as never,
    segmentRepo as never,
    em as never,
    media,
    content,
    script,
    voice,
  );

  return { service, em, script };
}

describe('the run and the outline it produces', () => {
  it('stores the outline on the conversation, and closes the block with its break', async () => {
    const { service, em } = build({ tail: null });

    await service.bufferAhead('chan-1');

    const written = em.persist.mock.calls.map(
      (call: unknown[]) => call[0] as { type: string; outline?: string | null },
    );
    expect(written.map((item) => item.type)).toEqual([
      'talk',
      'liner',
      'music',
    ]);
    expect(written[0].outline).toBe(OUTLINE);
  });
});

describe('what the run tells the model before it writes', () => {
  it('picks up the thread of the conversation that just aired', async () => {
    const { service, script } = build({
      tail: { playOrder: 3, type: 'talk', outline: '## STEP 4: VERDICT' },
    });

    await service.bufferAhead('chan-1');

    expect(script.generateScript).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Array),
      expect.stringContaining('## STEP 4: VERDICT'),
    );
  });

  it('opens the show when nothing has aired yet', async () => {
    const { service, script } = build({ tail: null });

    await service.bufferAhead('chan-1');

    expect(script.generateScript).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Array),
      expect.stringContaining('first conversation'),
    );
  });
});
