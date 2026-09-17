import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@mikro-orm/nestjs';
import { EntityManager } from '@mikro-orm/postgresql';
import { PlaybackService } from './playback.service';
import { QueueService } from './queue.service';
import { Channel } from './entities/channel.entity';
import { MusicSegment } from './entities/segment.entity';
import { StorageService } from '../infrastructure/storage/storage.service';
import * as fc from 'fast-check';
import { SegmentSchema } from '../infrastructure/database/schemas/channel.schema';

describe('PlaybackService', () => {
  let service: PlaybackService;
  let mathRandomSpy: jest.SpyInstance;

  const mockSegmentRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    count: jest.fn(),
    nativeDelete: jest.fn(),
  };

  interface MockEntityManager {
    flush: jest.Mock;
    transactional: jest.Mock;
    findOne: jest.Mock;
  }

  const mockEntityManager: MockEntityManager = {
    flush: jest.fn().mockResolvedValue(undefined),
    transactional: jest.fn(
      <T>(cb: (em: MockEntityManager) => Promise<T>): Promise<T> =>
        cb(mockEntityManager),
    ),
    findOne: jest.fn(),
  };

  const mockQueueService = {
    bufferAhead: jest.fn().mockResolvedValue(undefined),
    ensureInstantFiller: jest.fn().mockResolvedValue(undefined),
  };

  const mockStorageService = {
    getPublicUrl: jest.fn((k: string) => k),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaybackService,
        {
          provide: getRepositoryToken(SegmentSchema),
          useValue: mockSegmentRepo,
        },
        { provide: EntityManager, useValue: mockEntityManager },
        { provide: QueueService, useValue: mockQueueService },
        { provide: StorageService, useValue: mockStorageService },
      ],
    }).compile();

    service = module.get<PlaybackService>(PlaybackService);
    jest.clearAllMocks();

    mathRandomSpy = jest.spyOn(Math, 'random');
  });

  afterEach(() => {
    mathRandomSpy.mockRestore();
    jest.useRealTimers();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getLiveManifest', () => {
    describe('Cycle 3.1: Non-Existent Channel Guard', () => {
      it('throws NotFoundException when channel does not exist', async () => {
        mockEntityManager.findOne.mockResolvedValue(null);

        await expect(
          service.getLiveManifest('non-existent-id'),
        ).rejects.toThrow('Channel not found');
      });
    });

    describe('Cycle 3.2: Cold Start Initialization & Orphan Recovery', () => {
      it('initializes instant filler and triggers async bufferAhead on cold start', async () => {
        const channelId = 'chan-cold';
        const channel = Object.assign(new Channel(), {
          id: channelId,
          currentSegmentId: null,
          playheadStartedAt: null,
          lastActiveAt: null,
        });

        const firstSegment = Object.assign(new MusicSegment(), {
          id: 'seg-first',
          channelId,
          playOrder: 1,
          durationSeconds: 60,
          audioUrl: 'music/cold.mp3',
        });

        mockEntityManager.findOne.mockResolvedValue(channel);
        mockSegmentRepo.count
          .mockResolvedValueOnce(0) // Cold start segment count is 0
          .mockResolvedValue(5);
        mockSegmentRepo.findOne.mockResolvedValue(firstSegment);
        mockSegmentRepo.find = jest.fn().mockResolvedValue([firstSegment]);

        const result = await service.getLiveManifest(channelId);

        expect(mockQueueService.ensureInstantFiller).toHaveBeenCalledWith(
          channelId,
          6,
        );
        expect(mockQueueService.bufferAhead).toHaveBeenCalledWith(channelId);
        expect(result.visibility).toBe('public');
        expect(channel.currentSegmentId).toBe('seg-first');
        expect(channel.playheadStartedAt).toBeInstanceOf(Date);
        expect(channel.lastActiveAt).toBeInstanceOf(Date);
        expect(mockEntityManager.flush).toHaveBeenCalled();
      });

      it('recovers from orphaned/deleted playhead to the live edge without rewinding into retained historical segments', async () => {
        const channelId = 'chan-orphan-past';
        const channel = Object.assign(new Channel(), {
          id: channelId,
          currentSegmentId: 'deleted-segment-id',
          currentPlayOrder: 51,
          playheadStartedAt: new Date(),
          lastActiveAt: new Date(),
        });

        // 50 historical segments (played hours ago, retained for drift)
        // plus 6 active runway segments (playOrder 51 to 56)
        const allSegments: MusicSegment[] = [];
        for (let i = 1; i <= 56; i++) {
          allSegments.push(
            Object.assign(new MusicSegment(), {
              id: `seg-${i}`,
              channelId,
              playOrder: i,
              durationSeconds: 30,
              audioUrl: `music/track-${i}.mp3`,
            }),
          );
        }

        mockEntityManager.findOne.mockResolvedValue(channel);
        mockSegmentRepo.count.mockResolvedValue(56);
        // Current segment lookup fails because 'deleted-segment-id' was pruned or deleted
        mockSegmentRepo.findOne.mockImplementation(
          (criteria: {
            id?: string;
            channel?: string;
            playOrder?: { $gte?: number };
          }) => {
            if (criteria.id) return Promise.resolve(null);
            if (criteria.playOrder?.$gte !== undefined) {
              const min = criteria.playOrder.$gte;
              return Promise.resolve(
                allSegments.find((s) => s.playOrder >= min) ?? null,
              );
            }
            return Promise.resolve(allSegments[0] ?? null);
          },
        );

        mockSegmentRepo.find = jest.fn().mockImplementation(
          (
            criteria: { channel?: string; playOrder?: { $gte?: number } },
            options?: {
              orderBy?: { playOrder?: 'ASC' | 'DESC' };
              limit?: number;
            },
          ) => {
            const minOrder = criteria.playOrder?.$gte ?? 1;
            const matching = allSegments.filter((s) => s.playOrder >= minOrder);
            return Promise.resolve(matching.slice(0, options?.limit ?? 6));
          },
        );

        const result = await service.getLiveManifest(channelId);

        // Crucial Assertion: playhead MUST recover to the active live edge (playOrder: 51),
        // NOT rewind backwards into ancient history (playOrder: 1)!
        expect(channel.currentSegmentId).toBe('seg-51');
        expect(channel.currentPlayOrder).toBe(51);
        expect(result.manifest).toContain('#EXT-X-MEDIA-SEQUENCE:51');
        expect(result.manifest).not.toContain('#EXT-X-MEDIA-SEQUENCE:1\n');
      });

      it('recovers cleanly when queue is completely empty by synthesizing instant filler', async () => {
        const channelId = 'chan-empty-queue';
        const channel = Object.assign(new Channel(), {
          id: channelId,
          currentSegmentId: 'deleted-segment-id',
          currentPlayOrder: null,
          playheadStartedAt: new Date(),
          lastActiveAt: new Date(),
        });

        const fillerSegment = Object.assign(new MusicSegment(), {
          id: 'seg-filler-1',
          channelId,
          playOrder: 1,
          durationSeconds: 10,
          audioUrl: 'jingles/station-id.mp3',
        });

        mockEntityManager.findOne.mockResolvedValue(channel);
        mockSegmentRepo.count.mockResolvedValue(0);
        mockSegmentRepo.findOne.mockResolvedValue(null);

        mockSegmentRepo.find = jest
          .fn()
          .mockResolvedValueOnce([]) // initial windowSegments lookup returns empty
          .mockResolvedValueOnce([fillerSegment]); // after ensureInstantFiller

        const result = await service.getLiveManifest(channelId);

        expect(mockQueueService.ensureInstantFiller).toHaveBeenCalledWith(
          channelId,
          6,
        );
        expect(channel.currentSegmentId).toBe('seg-filler-1');
        expect(channel.currentPlayOrder).toBe(1);
        expect(result.manifest).toContain('#EXT-X-MEDIA-SEQUENCE:1');
      });

      it('recovers to live runway edge when BOTH currentSegmentId and currentPlayOrder are wiped to null on an established station', async () => {
        const channelId = 'chan-both-wiped';
        const channel = Object.assign(new Channel(), {
          id: channelId,
          currentSegmentId: null, // WIPED!
          currentPlayOrder: null, // WIPED!
          playheadStartedAt: new Date(Date.now() - 3600 * 1000), // Established station!
          lastActiveAt: new Date(),
        });

        // 50 historical segments (played hours ago) + 6 active runway segments (51 to 56)
        const allSegments: MusicSegment[] = [];
        for (let i = 1; i <= 56; i++) {
          allSegments.push(
            Object.assign(new MusicSegment(), {
              id: `seg-${i}`,
              channelId,
              playOrder: i,
              durationSeconds: 30,
              audioUrl: `music/track-${i}.mp3`,
            }),
          );
        }

        mockEntityManager.findOne.mockResolvedValue(channel);
        mockSegmentRepo.count.mockResolvedValue(56);
        mockSegmentRepo.findOne.mockImplementation(
          (
            criteria: {
              id?: string;
              channel?: string;
              playOrder?: { $gte?: number };
            },
            options?: { orderBy?: { playOrder?: 'ASC' | 'DESC' } },
          ) => {
            if (criteria.id) return Promise.resolve(null);
            if (criteria.playOrder?.$gte !== undefined) {
              const min = criteria.playOrder.$gte;
              return Promise.resolve(
                allSegments.find((s) => s.playOrder >= min) ?? null,
              );
            }
            if (options?.orderBy?.playOrder === 'ASC') {
              // Naive ASC returns segment 1 (the bug!)
              return Promise.resolve(allSegments[0] ?? null);
            }
            return Promise.resolve(null);
          },
        );

        mockSegmentRepo.find = jest.fn().mockImplementation(
          (
            criteria: { channel?: string; playOrder?: { $gte?: number } },
            options?: {
              orderBy?: { playOrder?: 'ASC' | 'DESC' };
              limit?: number;
            },
          ) => {
            if (options?.orderBy?.playOrder === 'DESC') {
              const sorted = [...allSegments].sort(
                (a, b) => b.playOrder - a.playOrder,
              );
              return Promise.resolve(sorted.slice(0, options.limit ?? 6));
            }
            const minOrder = criteria.playOrder?.$gte ?? 1;
            const matching = allSegments.filter((s) => s.playOrder >= minOrder);
            return Promise.resolve(matching.slice(0, options?.limit ?? 6));
          },
        );

        const result = await service.getLiveManifest(channelId);

        // Crucial: Must recover at live edge (51), NOT rewind to track 1!
        expect(channel.currentSegmentId).toBe('seg-51');
        expect(channel.currentPlayOrder).toBe(51);
        expect(result.manifest).toContain('#EXT-X-MEDIA-SEQUENCE:51');
        expect(result.manifest).not.toContain('#EXT-X-MEDIA-SEQUENCE:1\n');
      });
    });

    describe('Cycle 3.3: Idle Freeze & Post-Idle Resume (Invariants I-2 & I-5)', () => {
      it('freezes playhead during idle (> IDLE_TIMEOUT) and resumes seamlessly on reconnect', async () => {
        const channelId = 'chan-idle';
        const now = new Date('2026-09-10T12:00:00.000Z');
        jest.useFakeTimers();
        jest.setSystemTime(now);

        // Started 2000s ago, last active was 1000s ago (quiet for 1000s > 600s IDLE_TIMEOUT)
        const playheadStartedAt = new Date(now.getTime() - 2000 * 1000);
        const lastActiveAt = new Date(now.getTime() - 1000 * 1000);

        const channel = Object.assign(new Channel(), {
          id: channelId,
          currentSegmentId: 'seg-1',
          playheadStartedAt,
          lastActiveAt,
        });

        const segment = Object.assign(new MusicSegment(), {
          id: 'seg-1',
          channelId,
          playOrder: 1,
          durationSeconds: 2500, // Long segment so it is still within segment
          audioUrl: 'music/idle.mp3',
        });

        mockEntityManager.findOne.mockResolvedValue(channel);
        mockSegmentRepo.findOne.mockResolvedValue(segment);
        mockSegmentRepo.find = jest.fn().mockResolvedValue([segment]);
        mockSegmentRepo.count.mockResolvedValue(5);

        await service.getLiveManifest(channelId);

        // Elapsed before freeze = (2000 - 1000) + 600 = 1600 seconds
        // Rebased playheadStartedAt should be now - 1600s
        const expectedPlayheadStart = new Date(now.getTime() - 1600 * 1000);
        expect(channel.playheadStartedAt?.getTime()).toBe(
          expectedPlayheadStart.getTime(),
        );
        expect(channel.lastActiveAt?.getTime()).toBe(now.getTime());

        jest.useRealTimers();
      });
    });

    describe('Cycle 3.4: Active Playhead Time Advancement', () => {
      it('advances currentSegmentId when elapsed time exceeds segment duration', async () => {
        const channelId = 'chan-adv';
        const now = new Date('2026-09-10T12:00:00.000Z');
        jest.useFakeTimers();
        jest.setSystemTime(now);

        // Started 35s ago, lastActive was 2s ago
        const playheadStartedAt = new Date(now.getTime() - 35 * 1000);
        const lastActiveAt = new Date(now.getTime() - 2 * 1000);

        const channel = Object.assign(new Channel(), {
          id: channelId,
          currentSegmentId: 'seg-1',
          playheadStartedAt,
          lastActiveAt,
        });

        const segment1 = Object.assign(new MusicSegment(), {
          id: 'seg-1',
          channelId,
          playOrder: 1,
          durationSeconds: 30, // 30s duration, so 35s elapsed means it completed 5s ago
          audioUrl: 'music/song1.mp3',
        });

        const segment2 = Object.assign(new MusicSegment(), {
          id: 'seg-2',
          channelId,
          playOrder: 2,
          durationSeconds: 40,
          audioUrl: 'music/song2.mp3',
        });

        mockEntityManager.findOne.mockResolvedValue(channel);
        // First findOne for current segment returns segment1, then for segment2 returns segment2
        mockSegmentRepo.findOne
          .mockResolvedValueOnce(segment1) // find current
          .mockResolvedValueOnce(segment2); // find next (playOrder > 1)

        mockSegmentRepo.find = jest.fn().mockResolvedValue([segment2]);
        mockSegmentRepo.count.mockResolvedValue(5);

        await service.getLiveManifest(channelId);

        // Current segment should now be seg-2
        expect(channel.currentSegmentId).toBe('seg-2');
        // Playhead start should be shifted forward by segment1's 30s duration
        // now - 35s + 30s = now - 5s
        const expectedPlayheadStart = new Date(now.getTime() - 5 * 1000);
        expect(channel.playheadStartedAt?.getTime()).toBe(
          expectedPlayheadStart.getTime(),
        );

        jest.useRealTimers();
      });
    });

    describe('Cycle 3.5: Low Runway Replenishment (Rule Q-5)', () => {
      it('triggers queue bufferAhead when ready segment runway is low (< 4)', async () => {
        const channelId = 'chan-runway';
        const now = new Date('2026-09-10T12:00:00.000Z');
        jest.useFakeTimers();
        jest.setSystemTime(now);

        const channel = Object.assign(new Channel(), {
          id: channelId,
          currentSegmentId: 'seg-1',
          playheadStartedAt: now,
          lastActiveAt: now,
        });

        const segment = Object.assign(new MusicSegment(), {
          id: 'seg-1',
          channelId,
          playOrder: 1,
          durationSeconds: 100,
          audioUrl: 'music/song.mp3',
        });

        mockEntityManager.findOne.mockResolvedValue(channel);
        mockSegmentRepo.findOne.mockResolvedValueOnce(segment);
        // Only 2 segments ahead (< 4)
        mockSegmentRepo.count.mockImplementation(
          (criteria: { channel?: string; playOrder?: { $gt?: number } }) => {
            if (criteria.playOrder?.$gt !== undefined) {
              return Promise.resolve(2);
            }
            return Promise.resolve(5);
          },
        );
        mockSegmentRepo.find = jest.fn().mockResolvedValue([segment]);

        await service.getLiveManifest(channelId);

        expect(mockSegmentRepo.count).toHaveBeenCalledWith({
          channel: channelId,
          playOrder: { $gt: 1 },
        });
        expect(mockQueueService.bufferAhead).toHaveBeenCalledWith(channelId);

        jest.useRealTimers();
      });
    });

    describe('Cycle 3.6: Sliding Window Query & Manifest Return', () => {
      it('queries 6 segments from playhead and returns formatted m3u8 string', async () => {
        const channelId = 'chan-hls';
        const now = new Date('2026-09-10T12:00:00.000Z');
        jest.useFakeTimers();
        jest.setSystemTime(now);

        const channel = Object.assign(new Channel(), {
          id: channelId,
          currentSegmentId: 'seg-10',
          playheadStartedAt: now,
          lastActiveAt: now,
        });

        const currentSegment = Object.assign(new MusicSegment(), {
          id: 'seg-10',
          channelId,
          playOrder: 10,
          durationSeconds: 30,
          audioUrl: 'music/track10.mp3',
        });

        const windowSegments = [
          currentSegment,
          Object.assign(new MusicSegment(), {
            id: 'seg-11',
            channelId,
            playOrder: 11,
            durationSeconds: 45,
            audioUrl: 'music/track11.mp3',
          }),
        ];

        mockEntityManager.findOne.mockResolvedValue(channel);
        mockSegmentRepo.findOne.mockResolvedValueOnce(currentSegment);
        mockSegmentRepo.count.mockResolvedValueOnce(5);
        mockSegmentRepo.find = jest.fn().mockResolvedValueOnce(windowSegments);

        const { manifest, visibility } =
          await service.getLiveManifest(channelId);
        expect(visibility).toBe('public');

        expect(mockSegmentRepo.find).toHaveBeenCalledWith(
          {
            channel: channelId,
            playOrder: { $gte: 10 },
          },
          {
            orderBy: { playOrder: 'ASC' },
            limit: 6,
          },
        );

        expect(manifest).toContain('#EXTM3U\n');
        expect(manifest).toContain('#EXT-X-VERSION:3\n');
        expect(manifest).toContain('#EXT-X-TARGETDURATION:45\n');
        expect(manifest).toContain('#EXT-X-MEDIA-SEQUENCE:10\n');
        expect(manifest).toContain('#EXTINF:30.0,\nmusic/track10.mp3\n');
        expect(manifest).toContain('#EXTINF:45.0,\nmusic/track11.mp3\n');
        expect(manifest).not.toContain('#EXT-X-ENDLIST');

        jest.useRealTimers();
      });
    });

    describe('Cycle 4.4: Public vs Private Access Control (Rule A-3)', () => {
      it('permits unauthenticated access for public channels', async () => {
        const channelId = 'chan-public';
        const channel = Object.assign(new Channel(), {
          id: channelId,
          visibility: 'public',
          currentSegmentId: 'seg-1',
          playheadStartedAt: new Date(),
          lastActiveAt: new Date(),
        });
        const segment = Object.assign(new MusicSegment(), {
          id: 'seg-1',
          channelId,
          playOrder: 1,
          durationSeconds: 30,
          audioUrl: 'song.mp3',
        });

        mockEntityManager.findOne.mockResolvedValue(channel);
        mockSegmentRepo.findOne.mockResolvedValueOnce(segment);
        mockSegmentRepo.count.mockResolvedValueOnce(5);
        mockSegmentRepo.find = jest.fn().mockResolvedValueOnce([segment]);

        const { manifest, visibility } = await service.getLiveManifest(
          channelId,
          null,
        );
        expect(visibility).toBe('public');
        expect(manifest).toContain('#EXTM3U\n');
      });

      it('rejects unauthenticated access for private channels with UnauthorizedException', async () => {
        const channelId = 'chan-private';
        const channel = Object.assign(new Channel(), {
          id: channelId,
          visibility: 'private',
          ownerId: 'owner-1',
          currentSegmentId: 'seg-1',
          playheadStartedAt: new Date(),
          lastActiveAt: new Date(),
        });

        mockEntityManager.findOne.mockResolvedValue(channel);

        await expect(service.getLiveManifest(channelId, null)).rejects.toThrow(
          'Unauthorized',
        );
      });

      it('rejects non-owner non-admin user for private channels with ForbiddenException', async () => {
        const channelId = 'chan-private';
        const channel = Object.assign(new Channel(), {
          id: channelId,
          visibility: 'private',
          ownerId: 'owner-1',
          currentSegmentId: 'seg-1',
          playheadStartedAt: new Date(),
          lastActiveAt: new Date(),
        });

        mockEntityManager.findOne.mockResolvedValue(channel);

        await expect(
          service.getLiveManifest(channelId, {
            id: 'other-user',
            role: 'user',
          }),
        ).rejects.toThrow('Forbidden');
      });

      it('allows channel owner access to private channel', async () => {
        const channelId = 'chan-private';
        const channel = Object.assign(new Channel(), {
          id: channelId,
          visibility: 'private',
          ownerId: 'owner-1',
          currentSegmentId: 'seg-1',
          playheadStartedAt: new Date(),
          lastActiveAt: new Date(),
        });
        const segment = Object.assign(new MusicSegment(), {
          id: 'seg-1',
          channelId,
          playOrder: 1,
          durationSeconds: 30,
          audioUrl: 'song.mp3',
        });

        mockEntityManager.findOne.mockResolvedValue(channel);
        mockSegmentRepo.findOne.mockResolvedValueOnce(segment);
        mockSegmentRepo.count.mockResolvedValueOnce(5);
        mockSegmentRepo.find = jest.fn().mockResolvedValueOnce([segment]);

        const { manifest, visibility } = await service.getLiveManifest(
          channelId,
          {
            id: 'owner-1',
            role: 'user',
          },
        );
        expect(visibility).toBe('private');
        expect(manifest).toContain('#EXTM3U\n');
      });
    });

    describe('Cycle 3.7: Property-Based State Machine Invariant Fuzzing (fast-check)', () => {
      it('satisfies all broadcast invariants across randomized timelines', async () => {
        jest.useFakeTimers();

        await fc.assert(
          fc.asyncProperty(
            // Generate a random sequence of time steps between polls (from 1 second to 1500 seconds)
            fc.array(fc.integer({ min: 1, max: 1500 }), {
              minLength: 5,
              maxLength: 30,
            }),
            async (timeSteps) => {
              const channelId = `chan-fuzz-${Math.random()}`;
              let currentTime = new Date('2026-09-10T12:00:00.000Z');
              jest.setSystemTime(currentTime);

              // Create a sequence of 50 segments with varying durations (15s, 30s, 45s, 60s)
              const segments: MusicSegment[] = [];
              for (let i = 1; i <= 50; i++) {
                segments.push(
                  Object.assign(new MusicSegment(), {
                    id: `seg-${i}`,
                    channelId,
                    playOrder: i,
                    durationSeconds: [15, 30, 45, 60][i % 4],
                    audioUrl: `audio/track-${i}.mp3`,
                  }),
                );
              }

              const channel = Object.assign(new Channel(), {
                id: channelId,
                currentSegmentId: null as string | null,
                currentPlayOrder: null as number | null,
                playheadStartedAt: null as Date | null,
                lastActiveAt: null as Date | null,
              });

              // Mock repository state to act as a real stateful in-memory store for this run
              mockEntityManager.findOne.mockImplementation(() =>
                Promise.resolve(channel),
              );
              mockSegmentRepo.findOne.mockImplementation(
                (criteria: {
                  id?: string;
                  channel?: string;
                  playOrder?: { $gt?: number; $gte?: number };
                }) => {
                  if (criteria.id) {
                    return Promise.resolve(
                      segments.find((s) => s.id === criteria.id) ?? null,
                    );
                  }
                  if (
                    criteria.channel &&
                    criteria.playOrder?.$gt !== undefined
                  ) {
                    const threshold = criteria.playOrder.$gt;
                    return Promise.resolve(
                      segments.find((s) => s.playOrder > threshold) ?? null,
                    );
                  }
                  if (
                    criteria.channel &&
                    criteria.playOrder?.$gte !== undefined
                  ) {
                    const threshold = criteria.playOrder.$gte;
                    return Promise.resolve(
                      segments.find((s) => s.playOrder >= threshold) ?? null,
                    );
                  }
                  if (criteria.channel) {
                    return Promise.resolve(segments[0] ?? null);
                  }
                  return Promise.resolve(null);
                },
              );
              mockSegmentRepo.count.mockImplementation(
                (criteria: { playOrder?: { $gt?: number } }) => {
                  if (criteria.playOrder?.$gt !== undefined) {
                    const threshold = criteria.playOrder.$gt;
                    return Promise.resolve(
                      segments.filter((s) => s.playOrder > threshold).length,
                    );
                  }
                  return Promise.resolve(segments.length);
                },
              );
              mockSegmentRepo.find.mockImplementation(
                (
                  criteria: { channel?: string; playOrder?: { $gte?: number } },
                  options?: {
                    orderBy?: { playOrder?: 'ASC' | 'DESC' };
                    limit?: number;
                  },
                ) => {
                  if (options?.orderBy?.playOrder === 'DESC') {
                    const sorted = [...segments].sort(
                      (a, b) => b.playOrder - a.playOrder,
                    );
                    return Promise.resolve(sorted.slice(0, options.limit ?? 6));
                  }
                  const minOrder = criteria.playOrder?.$gte ?? 1;
                  return Promise.resolve(
                    segments
                      .filter((s) => s.playOrder >= minOrder)
                      .slice(0, options?.limit ?? 6),
                  );
                },
              );

              let previousMediaSequence = -1;

              // Cold start poll
              const { manifest: initialManifest } =
                await service.getLiveManifest(channelId);
              const initialSeqMatch = initialManifest.match(
                /#EXT-X-MEDIA-SEQUENCE:(\d+)/,
              );
              expect(initialSeqMatch).not.toBeNull();
              previousMediaSequence = parseInt(initialSeqMatch![1], 10);
              expect(previousMediaSequence).toBe(1);

              // Execute randomized time-travel poll loop
              for (const stepSeconds of timeSteps) {
                currentTime = new Date(
                  currentTime.getTime() + stepSeconds * 1000,
                );
                jest.setSystemTime(currentTime);

                const { manifest } = await service.getLiveManifest(channelId);

                // INVARIANT 1 (HLS-2): Media Sequence Monotonicity
                const seqMatch = manifest.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/);
                expect(seqMatch).not.toBeNull();
                const currentSeq = parseInt(seqMatch![1], 10);
                expect(currentSeq).toBeGreaterThanOrEqual(
                  previousMediaSequence,
                );
                previousMediaSequence = currentSeq;

                // INVARIANT 2: Current segment elapsed within duration bounds
                const activeSegment = segments.find(
                  (s) => s.id === channel.currentSegmentId,
                );
                expect(activeSegment).toBeDefined();
                const playheadStart = channel.playheadStartedAt;
                expect(playheadStart).toBeInstanceOf(Date);
                const elapsedInActiveSegment =
                  (currentTime.getTime() -
                    (playheadStart as unknown as Date).getTime()) /
                  1000;
                expect(elapsedInActiveSegment).toBeGreaterThanOrEqual(0);
                expect(elapsedInActiveSegment).toBeLessThanOrEqual(
                  activeSegment!.durationSeconds || 10,
                );

                // INVARIANT 3 (HLS-4): Liveness Contract
                expect(manifest).not.toContain('#EXT-X-ENDLIST');
              }
            },
          ),
          { numRuns: 50 },
        );

        jest.useRealTimers();
      });

      it('satisfies media sequence monotonicity even under intermittent playhead corruption/orphaning', async () => {
        jest.useFakeTimers();

        await fc.assert(
          fc.asyncProperty(
            // Sequence of poll steps, paired with a flag indicating whether playhead was corrupted
            fc.array(
              fc.record({
                stepSeconds: fc.integer({ min: 1, max: 120 }),
                corruptPlayhead: fc.boolean(),
              }),
              { minLength: 5, maxLength: 25 },
            ),
            async (steps) => {
              const channelId = `chan-orphan-fuzz-${Math.random()}`;
              let currentTime = new Date('2026-09-10T12:00:00.000Z');
              jest.setSystemTime(currentTime);

              const segments: MusicSegment[] = [];
              for (let i = 1; i <= 60; i++) {
                segments.push(
                  Object.assign(new MusicSegment(), {
                    id: `seg-${i}`,
                    channelId,
                    playOrder: i,
                    durationSeconds: 30,
                    audioUrl: `audio/track-${i}.mp3`,
                  }),
                );
              }

              const channel = Object.assign(new Channel(), {
                id: channelId,
                currentSegmentId: null as string | null,
                currentPlayOrder: null as number | null,
                playheadStartedAt: null as Date | null,
                lastActiveAt: null as Date | null,
              });

              mockEntityManager.findOne.mockImplementation(() =>
                Promise.resolve(channel),
              );

              mockSegmentRepo.findOne.mockImplementation(
                (criteria: {
                  id?: string;
                  channel?: string;
                  playOrder?: { $gt?: number; $gte?: number };
                }) => {
                  if (criteria.id) {
                    return Promise.resolve(
                      segments.find((s) => s.id === criteria.id) ?? null,
                    );
                  }
                  if (
                    criteria.channel &&
                    criteria.playOrder?.$gt !== undefined
                  ) {
                    const threshold = criteria.playOrder.$gt;
                    return Promise.resolve(
                      segments.find((s) => s.playOrder > threshold) ?? null,
                    );
                  }
                  if (
                    criteria.channel &&
                    criteria.playOrder?.$gte !== undefined
                  ) {
                    const threshold = criteria.playOrder.$gte;
                    return Promise.resolve(
                      segments.find((s) => s.playOrder >= threshold) ?? null,
                    );
                  }
                  if (criteria.channel) {
                    return Promise.resolve(segments[0] ?? null);
                  }
                  return Promise.resolve(null);
                },
              );

              mockSegmentRepo.count.mockImplementation(
                (criteria: { playOrder?: { $gt?: number } }) => {
                  if (criteria.playOrder?.$gt !== undefined) {
                    const threshold = criteria.playOrder.$gt;
                    return Promise.resolve(
                      segments.filter((s) => s.playOrder > threshold).length,
                    );
                  }
                  return Promise.resolve(segments.length);
                },
              );

              mockSegmentRepo.find.mockImplementation(
                (
                  criteria: { channel?: string; playOrder?: { $gte?: number } },
                  options?: {
                    orderBy?: { playOrder?: 'ASC' | 'DESC' };
                    limit?: number;
                  },
                ) => {
                  if (options?.orderBy?.playOrder === 'DESC') {
                    const sorted = [...segments].sort(
                      (a, b) => b.playOrder - a.playOrder,
                    );
                    return Promise.resolve(sorted.slice(0, options.limit ?? 6));
                  }
                  const minOrder = criteria.playOrder?.$gte ?? 1;
                  return Promise.resolve(
                    segments
                      .filter((s) => s.playOrder >= minOrder)
                      .slice(0, options?.limit ?? 6),
                  );
                },
              );

              let previousMediaSequence = -1;

              // Initial cold start
              const { manifest: initialManifest } =
                await service.getLiveManifest(channelId);
              const initialSeqMatch = initialManifest.match(
                /#EXT-X-MEDIA-SEQUENCE:(\d+)/,
              );
              expect(initialSeqMatch).not.toBeNull();
              previousMediaSequence = parseInt(initialSeqMatch![1], 10);

              for (const { stepSeconds, corruptPlayhead } of steps) {
                currentTime = new Date(
                  currentTime.getTime() + stepSeconds * 1000,
                );
                jest.setSystemTime(currentTime);

                if (corruptPlayhead) {
                  // Simulate playhead pointing to a row that was deleted/orphaned
                  channel.currentSegmentId = 'corrupted-missing-row-id';
                }

                const { manifest } = await service.getLiveManifest(channelId);

                // INVARIANT (HLS-2): Sequence monotonicity must NEVER regress into history!
                const seqMatch = manifest.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/);
                expect(seqMatch).not.toBeNull();
                const currentSeq = parseInt(seqMatch![1], 10);
                expect(currentSeq).toBeGreaterThanOrEqual(
                  previousMediaSequence,
                );
                previousMediaSequence = currentSeq;

                // INVARIANT (HLS-4): Liveness Contract
                expect(manifest).not.toContain('#EXT-X-ENDLIST');

                // INVARIANT: Channel repaired to a valid segment
                expect(channel.currentSegmentId).not.toBe(
                  'corrupted-missing-row-id',
                );
                const activeSegment = segments.find(
                  (s) => s.id === channel.currentSegmentId,
                );
                expect(activeSegment).toBeDefined();
              }
            },
          ),
          { numRuns: 30 },
        );

        jest.useRealTimers();
      });
    });

    describe('Cycle 3.8: Issue 1 (MEDIA-SEQUENCE alignment)', () => {
      it('ensures MEDIA-SEQUENCE matches the first valid playable chunk when earlier segment has missing audio', async () => {
        const channelId = 'chan-issue-1';
        const channel = Object.assign(new Channel(), {
          id: channelId,
          currentSegmentId: 'seg-10',
          currentPlayOrder: 10,
          playheadStartedAt: new Date(),
          lastActiveAt: new Date(),
        });

        // Segment 10 has empty audioUrl, segment 11 has valid audio
        const seg10 = Object.assign(new MusicSegment(), {
          id: 'seg-10',
          channelId,
          playOrder: 10,
          durationSeconds: 30,
          audioUrl: '',
        });
        const seg11 = Object.assign(new MusicSegment(), {
          id: 'seg-11',
          channelId,
          playOrder: 11,
          durationSeconds: 30,
          audioUrl: 'music/track-11.mp3',
        });

        mockEntityManager.findOne.mockResolvedValue(channel);
        mockSegmentRepo.count.mockResolvedValue(2);
        mockSegmentRepo.findOne.mockResolvedValue(seg10);
        mockSegmentRepo.find = jest.fn().mockResolvedValue([seg10, seg11]);

        const result = await service.getLiveManifest(channelId);

        // Sequence must match segment 11 (the first playable audio file), NOT segment 10
        expect(result.manifest).toContain('#EXT-X-MEDIA-SEQUENCE:11\n');
        expect(result.manifest).not.toContain('#EXT-X-MEDIA-SEQUENCE:10\n');
        expect(result.manifest).toContain('music/track-11.mp3');
      });

      it('Issue 2: does not rewind to track 1 when playheadStartedAt is null on an established channel', async () => {
        const channelId = 'chan-issue-2';
        const channel = Object.assign(new Channel(), {
          id: channelId,
          currentSegmentId: null,
          currentPlayOrder: 150, // Established station!
          playheadStartedAt: null, // Lost timestamp!
          lastActiveAt: new Date(),
        });

        const seg1 = Object.assign(new MusicSegment(), {
          id: 'seg-1',
          channelId,
          playOrder: 1,
          durationSeconds: 30,
          audioUrl: 'music/track-1.mp3',
        });
        const seg150 = Object.assign(new MusicSegment(), {
          id: 'seg-150',
          channelId,
          playOrder: 150,
          durationSeconds: 30,
          audioUrl: 'music/track-150.mp3',
        });

        mockEntityManager.findOne.mockResolvedValue(channel);
        mockSegmentRepo.count.mockResolvedValue(10);
        mockSegmentRepo.findOne.mockImplementation(
          (
            criteria: {
              id?: string;
              playOrder?: { $gte?: number; $gt?: number };
              channel?: string;
            },
            options?: { orderBy?: { playOrder?: 'ASC' | 'DESC' } },
          ) => {
            if (criteria.playOrder?.$gte === 150)
              return Promise.resolve(seg150);
            if (options?.orderBy?.playOrder === 'ASC')
              return Promise.resolve(seg1);
            return Promise.resolve(null);
          },
        );
        mockSegmentRepo.find = jest.fn().mockResolvedValue([seg150]);

        const result = await service.getLiveManifest(channelId);

        // Must resume from 150, never rewinding to track 1
        expect(channel.currentPlayOrder).toBe(150);
        expect(channel.currentSegmentId).toBe('seg-150');
        expect(channel.playheadStartedAt).toBeInstanceOf(Date);
        expect(result.manifest).toContain('#EXT-X-MEDIA-SEQUENCE:150\n');
      });

      it('Issue 3: triggers idle freeze when lastActiveAt is null on an active station that was quiet', async () => {
        const channelId = 'chan-issue-3';
        const now = new Date();
        const twoHoursAgo = new Date(now.getTime() - 7200 * 1000);
        const channel = Object.assign(new Channel(), {
          id: channelId,
          currentSegmentId: 'seg-1',
          currentPlayOrder: 1,
          playheadStartedAt: twoHoursAgo, // Station started 2h ago
          lastActiveAt: null, // Missing lastActiveAt!
        });

        const seg1 = Object.assign(new MusicSegment(), {
          id: 'seg-1',
          channelId,
          playOrder: 1,
          durationSeconds: 3600, // Very long segment
          audioUrl: 'music/long.mp3',
        });

        mockEntityManager.findOne.mockResolvedValue(channel);
        mockSegmentRepo.count.mockResolvedValue(10);
        mockSegmentRepo.findOne.mockResolvedValue(seg1);
        mockSegmentRepo.find = jest.fn().mockResolvedValue([seg1]);

        await service.getLiveManifest(channelId);

        // Rebased playheadStartedAt should be now - 600s (idle timeout), NOT continuing from 2h ago
        expect(channel.playheadStartedAt?.getTime()).toBeCloseTo(
          now.getTime() - 600 * 1000,
          -2,
        );
        expect(channel.lastActiveAt).toBeInstanceOf(Date);
      });

      it('Issue 4: skips corrupted segment with negative or non-positive duration without infinite loop', async () => {
        const channelId = 'chan-issue-4';
        const channel = Object.assign(new Channel(), {
          id: channelId,
          currentSegmentId: 'seg-bad',
          currentPlayOrder: 1,
          playheadStartedAt: new Date(),
          lastActiveAt: new Date(),
        });

        const badSeg = Object.assign(new MusicSegment(), {
          id: 'seg-bad',
          channelId,
          playOrder: 1,
          audioUrl: 'music/bad.mp3',
        });
        // Deliberately simulate corrupted row bypassing entity setter
        Object.defineProperty(badSeg, 'durationSeconds', {
          value: -1,
          configurable: true,
        });
        const goodSeg = Object.assign(new MusicSegment(), {
          id: 'seg-good',
          channelId,
          playOrder: 2,
          durationSeconds: 30,
          audioUrl: 'music/good.mp3',
        });

        mockEntityManager.findOne.mockResolvedValue(channel);
        mockSegmentRepo.count.mockResolvedValue(5);
        mockSegmentRepo.findOne.mockImplementation(
          (criteria: {
            id?: string;
            playOrder?: { $gte?: number; $gt?: number };
            channel?: string;
          }) => {
            if (criteria.id === 'seg-bad') return Promise.resolve(badSeg);
            if (criteria.playOrder?.$gt === 1) return Promise.resolve(goodSeg);
            return Promise.resolve(null);
          },
        );
        mockSegmentRepo.find = jest.fn().mockResolvedValue([badSeg, goodSeg]);

        const result = await service.getLiveManifest(channelId);

        // Should safely skip seg-bad and not render negative duration
        expect(result.manifest).not.toContain('#EXTINF:-1');
        expect(channel.currentSegmentId).toBe('seg-good');
        expect(channel.currentPlayOrder).toBe(2);
        expect(result.manifest).toContain('music/good.mp3');
      });

      it('Issue 5: ensures instant filler executes outside the pessimistic write transaction lock', async () => {
        const channelId = 'chan-issue-5';
        const channel = Object.assign(new Channel(), {
          id: channelId,
          currentSegmentId: 'seg-1',
          currentPlayOrder: 1,
          playheadStartedAt: new Date(),
          lastActiveAt: new Date(),
        });

        let insideTransaction = false;
        let fillerCalledInsideTx = false;

        mockEntityManager.transactional.mockImplementation(
          async <T>(cb: (em: MockEntityManager) => Promise<T>): Promise<T> => {
            insideTransaction = true;
            try {
              return await cb(mockEntityManager);
            } finally {
              insideTransaction = false;
            }
          },
        );

        mockQueueService.ensureInstantFiller.mockImplementation(() => {
          if (insideTransaction) {
            fillerCalledInsideTx = true;
          }
          return Promise.resolve();
        });

        const seg1 = Object.assign(new MusicSegment(), {
          id: 'seg-1',
          channelId,
          playOrder: 1,
          durationSeconds: 30,
          audioUrl: 'music/1.mp3',
        });

        mockEntityManager.findOne.mockResolvedValue(channel);
        mockSegmentRepo.count.mockResolvedValue(1);
        mockSegmentRepo.findOne.mockResolvedValue(seg1);
        mockSegmentRepo.find = jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([seg1]);

        await service.getLiveManifest(channelId);

        expect(mockQueueService.ensureInstantFiller).toHaveBeenCalledWith(
          channelId,
          6,
        );
        expect(fillerCalledInsideTx).toBe(false);
      });
    });
  });
});
