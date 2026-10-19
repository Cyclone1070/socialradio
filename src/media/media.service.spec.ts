import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@mikro-orm/nestjs';
import { MediaService } from './media.service';
import {
  MusicTrackSchema,
  JingleSchema,
  LinerSchema,
} from '../infrastructure/database/schemas/media.schema';
import { NotFoundException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

describe('MediaService', () => {
  let service: MediaService;

  const mockMusicRepo = {
    findAll: jest.fn(),
  };

  const mockJingleRepo = {
    findAll: jest.fn(),
  };

  const mockLinerRepo = {
    findAll: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaService,
        {
          provide: getRepositoryToken(MusicTrackSchema),
          useValue: mockMusicRepo,
        },
        { provide: getRepositoryToken(JingleSchema), useValue: mockJingleRepo },
        { provide: getRepositoryToken(LinerSchema), useValue: mockLinerRepo },
      ],
    }).compile();

    service = module.get<MediaService>(MediaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getRandomMusic', () => {
    it('should return a random music track as a AudioFileRef', async () => {
      const tracks = [
        {
          id: '1',
          title: 'Song 1',
          artist: 'Art 1',
          filePath: 'song1.mp3',
          durationSeconds: 180,
        },
        {
          id: '2',
          title: 'Song 2',
          artist: 'Art 2',
          filePath: 'song2.mp3',
          durationSeconds: 240,
        },
      ];
      mockMusicRepo.findAll.mockResolvedValue(tracks);

      const result = await service.getRandomMusic();

      expect(mockMusicRepo.findAll).toHaveBeenCalled();
      expect(tracks.map((t) => t.filePath)).toContain(result.filePath);
      expect([180, 240]).toContain(result.durationSeconds);
    });

    it('should throw NotFoundException if no music tracks exist', async () => {
      mockMusicRepo.findAll.mockResolvedValue([]);

      await expect(service.getRandomMusic()).rejects.toThrow(NotFoundException);
    });

    it('warns with the catalog type when a pool is empty', async () => {
      mockMusicRepo.findAll.mockResolvedValue([]);
      const warnSpy = jest
        .spyOn(PinoLogger.prototype, 'warn')
        .mockImplementation(() => {});

      await expect(service.getRandomMusic()).rejects.toThrow(NotFoundException);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'music' }),
        expect.stringContaining('empty'),
      );
    });
  });

  describe('getRandomLiner', () => {
    it('should return a liner with the words it says', async () => {
      mockLinerRepo.findAll.mockResolvedValue([
        {
          id: '1',
          text: 'We will be right back.',
          filePath: 'liners/back-01.mp3',
          durationSeconds: 3.9,
        },
      ]);

      const result = await service.getRandomLiner();

      expect(mockLinerRepo.findAll).toHaveBeenCalled();
      expect(result).toEqual({
        filePath: 'liners/back-01.mp3',
        durationSeconds: 3.9,
        text: 'We will be right back.',
      });
    });

    it('should throw NotFoundException if no liners exist', async () => {
      mockLinerRepo.findAll.mockResolvedValue([]);

      await expect(service.getRandomLiner()).rejects.toThrow(NotFoundException);
    });
  });

  describe('getRandomJingle', () => {
    it('should return a random jingle track as a AudioFileRef', async () => {
      const jingles = [
        {
          id: '1',
          name: 'Jingle 1',
          filePath: 'jingle1.mp3',
          durationSeconds: 5,
        },
      ];
      mockJingleRepo.findAll.mockResolvedValue(jingles);

      const result = await service.getRandomJingle();

      expect(mockJingleRepo.findAll).toHaveBeenCalled();
      expect(result).toEqual({
        filePath: 'jingle1.mp3',
        durationSeconds: 5,
        name: 'Jingle 1',
      });
    });

    it('should throw NotFoundException if no jingles exist', async () => {
      mockJingleRepo.findAll.mockResolvedValue([]);

      await expect(service.getRandomJingle()).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
