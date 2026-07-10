import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MediaService } from './media.service';
import { MusicTrack } from './entities/music-track.entity';
import { AdTrack } from './entities/ad-track.entity';
import { Jingle } from './entities/jingle.entity';
import { NotFoundException } from '@nestjs/common';

describe('MediaService', () => {
  let service: MediaService;

  const mockMusicRepo = {
    find: jest.fn(),
  };

  const mockAdRepo = {
    find: jest.fn(),
  };

  const mockJingleRepo = {
    find: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaService,
        { provide: getRepositoryToken(MusicTrack), useValue: mockMusicRepo },
        { provide: getRepositoryToken(AdTrack), useValue: mockAdRepo },
        { provide: getRepositoryToken(Jingle), useValue: mockJingleRepo },
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
      mockMusicRepo.find.mockResolvedValue(tracks);

      const result = await service.getRandomMusic();

      expect(mockMusicRepo.find).toHaveBeenCalled();
      expect(tracks.map((t) => t.filePath)).toContain(result.filePath);
      expect([180, 240]).toContain(result.durationSeconds);
    });

    it('should throw NotFoundException if no music tracks exist', async () => {
      mockMusicRepo.find.mockResolvedValue([]);

      await expect(service.getRandomMusic()).rejects.toThrow(NotFoundException);
    });
  });

  describe('getRandomAd', () => {
    it('should return a random ad track as a AudioFileRef', async () => {
      const ads = [
        {
          id: '1',
          advertiser: 'Brand 1',
          filePath: 'ad1.mp3',
          durationSeconds: 30,
        },
      ];
      mockAdRepo.find.mockResolvedValue(ads);

      const result = await service.getRandomAd();

      expect(mockAdRepo.find).toHaveBeenCalled();
      expect(result).toEqual({
        filePath: 'ad1.mp3',
        durationSeconds: 30,
        advertiser: 'Brand 1',
      });
    });

    it('should throw NotFoundException if no ads exist', async () => {
      mockAdRepo.find.mockResolvedValue([]);

      await expect(service.getRandomAd()).rejects.toThrow(NotFoundException);
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
      mockJingleRepo.find.mockResolvedValue(jingles);

      const result = await service.getRandomJingle();

      expect(mockJingleRepo.find).toHaveBeenCalled();
      expect(result).toEqual({
        filePath: 'jingle1.mp3',
        durationSeconds: 5,
        name: 'Jingle 1',
      });
    });

    it('should throw NotFoundException if no jingles exist', async () => {
      mockJingleRepo.find.mockResolvedValue([]);

      await expect(service.getRandomJingle()).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
