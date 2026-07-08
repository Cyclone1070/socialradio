import { Test, TestingModule } from '@nestjs/testing';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { Request } from 'express';

describe('UserController', () => {
  let controller: UserController;

  const mockUserService = {
    findById: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        {
          provide: UserService,
          useValue: mockUserService,
        },
      ],
    }).compile();

    controller = module.get<UserController>(UserController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getMe', () => {
    it('should return the current user response DTO', async () => {
      const user = {
        id: 'uuid-123',
        email: 'test@example.com',
        passwordHash: 'hash',
        createdAt: new Date(),
      };
      mockUserService.findById.mockResolvedValue(user);

      const req = { user: { id: 'uuid-123' } } as unknown as Request;
      const result = await controller.getMe(req);

      expect(mockUserService.findById).toHaveBeenCalledWith('uuid-123');
      expect(result).toEqual({
        id: user.id,
        email: user.email,
        createdAt: user.createdAt,
      });
    });

    it('should throw NotFoundException if user does not exist', async () => {
      mockUserService.findById.mockResolvedValue(null);

      const req = { user: { id: 'uuid-123' } } as unknown as Request;

      await expect(controller.getMe(req)).rejects.toThrow();
      expect(mockUserService.findById).toHaveBeenCalledWith('uuid-123');
    });
  });
});
