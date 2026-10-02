import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@mikro-orm/nestjs';
import { EntityManager } from '@mikro-orm/postgresql';
import { PinoLogger } from 'nestjs-pino';
import { UserService } from './user.service';
import { User } from './entities/user.entity';
import { UserSchema } from '../infrastructure/database/schemas/user.schema';
import { ConflictException } from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

describe('UserService', () => {
  let service: UserService;

  const mockUserRepo = {
    findOne: jest.fn(),
  };

  const mockEntityManager = {
    persist: jest.fn().mockReturnThis(),
    flush: jest.fn(),
    findOne: jest.fn(),
    fork: jest.fn(),
  };
  mockEntityManager.fork.mockReturnValue(mockEntityManager);

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: getRepositoryToken(UserSchema),
          useValue: mockUserRepo,
        },
        {
          provide: EntityManager,
          useValue: mockEntityManager,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    jest.clearAllMocks();
    mockEntityManager.persist.mockReturnThis();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should successfully create a new user', async () => {
      const email = 'test@example.com';
      const passwordHash = 'hashed_password';

      mockUserRepo.findOne.mockResolvedValue(null);
      mockEntityManager.persist.mockImplementation((user: User) => {
        Object.assign(user, { id: 'uuid' });
        return mockEntityManager;
      });

      const result = await service.create(
        { email, password: 'password123' },
        passwordHash,
      );

      expect(mockUserRepo.findOne).toHaveBeenCalledWith({ email });
      expect(mockEntityManager.persist).toHaveBeenCalledWith(
        expect.objectContaining({ email, _passwordHash: passwordHash }),
      );
      expect(mockEntityManager.flush).toHaveBeenCalled();
      expect(result.id).toBe('uuid');
      expect(result.email).toBe(email);
    });

    it('logs the new userId at info', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);
      mockEntityManager.persist.mockImplementation((user: User) => {
        Object.assign(user, { id: 'uuid-1' });
        return mockEntityManager;
      });

      const infoSpy = jest
        .spyOn(PinoLogger.prototype, 'info')
        .mockImplementation(() => {});

      await service.create({ email: 'new@example.com', password: 'x' }, 'hash');

      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'uuid-1' }),
        expect.stringContaining('registered'),
      );
    });

    it('should throw ConflictException if email is already registered', async () => {
      const email = 'existing@example.com';
      const passwordHash = 'hashed_password';
      const existingUser = Object.assign(new User(), {
        id: 'uuid',
        email,
        passwordHash,
      });

      mockUserRepo.findOne.mockResolvedValue(existingUser);

      await expect(
        service.create({ email, password: 'password123' }, passwordHash),
      ).rejects.toThrow(ConflictException);

      expect(mockUserRepo.findOne).toHaveBeenCalledWith({ email });
      expect(mockEntityManager.flush).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('should return user when found by ID', async () => {
      const user = Object.assign(new User(), {
        id: 'uuid',
        email: 'test@example.com',
        passwordHash: 'hash',
      });
      mockUserRepo.findOne.mockResolvedValue(user);

      const result = await service.findById('uuid');

      expect(mockUserRepo.findOne).toHaveBeenCalledWith({ id: 'uuid' });
      expect(result).toEqual(user);
    });

    it('should return null when user is not found by ID', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);

      const result = await service.findById('uuid');

      expect(mockUserRepo.findOne).toHaveBeenCalledWith({ id: 'uuid' });
      expect(result).toBeNull();
    });
  });

  describe('findByEmail', () => {
    it('should return user when found by email', async () => {
      const user = Object.assign(new User(), {
        id: 'uuid',
        email: 'test@example.com',
        passwordHash: 'hash',
      });
      mockUserRepo.findOne.mockResolvedValue(user);

      const result = await service.findByEmail('test@example.com');

      expect(mockUserRepo.findOne).toHaveBeenCalledWith({
        email: 'test@example.com',
      });
      expect(result).toEqual(user);
    });

    it('should return null when user is not found by email', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);

      const result = await service.findByEmail('test@example.com');

      expect(mockUserRepo.findOne).toHaveBeenCalledWith({
        email: 'test@example.com',
      });
      expect(result).toBeNull();
    });
  });

  describe('seeding the admin on boot', () => {
    beforeEach(() => {
      mockConfigService.get.mockImplementation((key: string) =>
        key === 'ADMIN_EMAIL' ? 'admin@example.com' : 'correct-horse',
      );
      mockEntityManager.findOne.mockResolvedValue(null);
    });

    it('treats another instance having seeded it first as done, not as a crash', async () => {
      // A rolling deploy puts two instances on a fresh database; both see no admin,
      // both insert, and the loser gets a unique violation. Losing that race is fine.
      mockEntityManager.flush.mockRejectedValueOnce(
        Object.assign(
          new Error('duplicate key value violates unique constraint'),
          {
            code: '23505',
          },
        ),
      );

      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });

    it('still fails loudly when the insert failed for any other reason', async () => {
      mockEntityManager.flush.mockRejectedValueOnce(
        new Error('database is away'),
      );

      await expect(service.onModuleInit()).rejects.toThrow('database is away');
    });
  });
});
