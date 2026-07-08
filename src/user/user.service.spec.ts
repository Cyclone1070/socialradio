import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserService } from './user.service';
import { User } from './entities/user.entity';
import { ConflictException } from '@nestjs/common';

describe('UserService', () => {
  let service: UserService;
  let repo: Repository<User>;

  const mockUserRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOneBy: jest.fn(),
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepo,
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    repo = module.get<Repository<User>>(getRepositoryToken(User));
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should successfully create a new user', async () => {
      const email = 'test@example.com';
      const passwordHash = 'hashed_password';
      const user = { id: 'uuid', email, passwordHash, createdAt: new Date() };

      mockUserRepo.findOneBy.mockResolvedValue(null);
      mockUserRepo.create.mockReturnValue(user);
      mockUserRepo.save.mockResolvedValue(user);

      const result = await (service as any).create({ email, password: 'password123' }, passwordHash);

      expect(mockUserRepo.findOneBy).toHaveBeenCalledWith({ email });
      expect(mockUserRepo.create).toHaveBeenCalledWith({ email, passwordHash });
      expect(mockUserRepo.save).toHaveBeenCalledWith(user);
      expect(result).toEqual({
        id: user.id,
        email: user.email,
        createdAt: user.createdAt,
      });
    });

    it('should throw ConflictException if email is already registered', async () => {
      const email = 'existing@example.com';
      const passwordHash = 'hashed_password';
      const existingUser = { id: 'uuid', email, passwordHash, createdAt: new Date() };

      mockUserRepo.findOneBy.mockResolvedValue(existingUser);

      await expect(
        (service as any).create({ email, password: 'password123' }, passwordHash)
      ).rejects.toThrow(ConflictException);

      expect(mockUserRepo.findOneBy).toHaveBeenCalledWith({ email });
      expect(mockUserRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('should return user when found by ID', async () => {
      const user = { id: 'uuid', email: 'test@example.com', passwordHash: 'hash', createdAt: new Date() };
      mockUserRepo.findOneBy.mockResolvedValue(user);

      const result = await (service as any).findById('uuid');

      expect(mockUserRepo.findOneBy).toHaveBeenCalledWith({ id: 'uuid' });
      expect(result).toEqual(user);
    });

    it('should return null when user is not found by ID', async () => {
      mockUserRepo.findOneBy.mockResolvedValue(null);

      const result = await (service as any).findById('uuid');

      expect(mockUserRepo.findOneBy).toHaveBeenCalledWith({ id: 'uuid' });
      expect(result).toBeNull();
    });
  });

  describe('findByEmail', () => {
    it('should return user when found by email', async () => {
      const user = { id: 'uuid', email: 'test@example.com', passwordHash: 'hash', createdAt: new Date() };
      mockUserRepo.findOneBy.mockResolvedValue(user);

      const result = await (service as any).findByEmail('test@example.com');

      expect(mockUserRepo.findOneBy).toHaveBeenCalledWith({ email: 'test@example.com' });
      expect(result).toEqual(user);
    });

    it('should return null when user is not found by email', async () => {
      mockUserRepo.findOneBy.mockResolvedValue(null);

      const result = await (service as any).findByEmail('test@example.com');

      expect(mockUserRepo.findOneBy).toHaveBeenCalledWith({ email: 'test@example.com' });
      expect(result).toBeNull();
    });
  });
});
