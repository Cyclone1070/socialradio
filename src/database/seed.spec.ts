import { runSeed } from './seed';
import { DataSource, Repository } from 'typeorm';
import { User } from '../user/entities/user.entity';
import { Subreddit } from '../domain/entities/subreddit.entity';
import { Jingle } from '../media/entities/jingle.entity';
import { MusicTrack } from '../media/entities/music-track.entity';
import { Channel } from '../channel/entities/channel.entity';
import { ChannelSubreddit } from '../channel/entities/channel-subreddit.entity';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt');

describe('Database Seed Script', () => {
  let mockDataSource: DataSource;

  const mockUserRepo = {
    findOneBy: jest.fn(),
    create: jest.fn((u: Record<string, unknown>) => ({
      id: 'user-uuid',
      ...u,
    })),
    save: jest.fn((u: Record<string, unknown>) =>
      Promise.resolve({ id: 'user-uuid', ...u }),
    ),
  };

  const mockSubredditRepo = {
    findOneBy: jest.fn(),
    create: jest.fn((s: Record<string, unknown>) => ({ id: 'sub-uuid', ...s })),
    save: jest.fn((s: Record<string, unknown>) =>
      Promise.resolve({ id: 'sub-uuid', ...s }),
    ),
  };

  const mockJingleRepo = {
    count: jest.fn(),
    create: jest.fn((j: Record<string, unknown>) => ({
      id: 'jingle-uuid',
      ...j,
    })),
    save: jest.fn((j: Record<string, unknown>) =>
      Promise.resolve({ id: 'jingle-uuid', ...j }),
    ),
  };

  const mockMusicRepo = {
    count: jest.fn(),
    create: jest.fn((m: Record<string, unknown>) => ({
      id: 'music-uuid',
      ...m,
    })),
    save: jest.fn((m: Record<string, unknown>) =>
      Promise.resolve({ id: 'music-uuid', ...m }),
    ),
  };

  const mockChannelRepo = {
    findOneBy: jest.fn(),
    create: jest.fn((c: Record<string, unknown>) => ({
      id: 'chan-uuid',
      ...c,
    })),
    save: jest.fn((c: Record<string, unknown>) =>
      Promise.resolve({ id: 'chan-uuid', ...c }),
    ),
  };

  const mockChanSubRepo = {
    findOneBy: jest.fn(),
    create: jest.fn((cs: Record<string, unknown>) => ({
      id: 'cs-uuid',
      ...cs,
    })),
    save: jest.fn((cs: Record<string, unknown>) =>
      Promise.resolve({ id: 'cs-uuid', ...cs }),
    ),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockDataSource = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === User) return mockUserRepo as unknown as Repository<User>;
        if (entity === Subreddit)
          return mockSubredditRepo as unknown as Repository<Subreddit>;
        if (entity === Jingle)
          return mockJingleRepo as unknown as Repository<Jingle>;
        if (entity === MusicTrack)
          return mockMusicRepo as unknown as Repository<MusicTrack>;
        if (entity === Channel)
          return mockChannelRepo as unknown as Repository<Channel>;
        if (entity === ChannelSubreddit)
          return mockChanSubRepo as unknown as Repository<ChannelSubreddit>;
        return mockUserRepo as unknown as Repository<User>;
      }),
    } as unknown as DataSource;

    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_password');
  });

  it('should seed admin user, subreddits, media assets, and channel', async () => {
    mockUserRepo.findOneBy.mockResolvedValue(null);
    mockSubredditRepo.findOneBy.mockResolvedValue(null);
    mockJingleRepo.count.mockResolvedValue(0);
    mockMusicRepo.count.mockResolvedValue(0);
    mockChannelRepo.findOneBy.mockResolvedValue(null);
    mockChanSubRepo.findOneBy.mockResolvedValue(null);

    await runSeed(mockDataSource, 'admin@socialradio.com', 'AdminPass123!');

    expect(mockUserRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'admin@socialradio.com',
        passwordHash: 'hashed_password',
      }),
    );
    expect(mockSubredditRepo.save).toHaveBeenCalledTimes(3);
    expect(mockJingleRepo.save).toHaveBeenCalled();
    expect(mockMusicRepo.save).toHaveBeenCalled();
    expect(mockChannelRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Tech & Trivia 24/7',
        ownerId: 'user-uuid',
      }),
    );
  });
});
