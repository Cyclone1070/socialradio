import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { UserService } from '../user/user.service';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let userService: UserService;

  const mockUserService = {
    findById: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: UserService, useValue: mockUserService },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
    userService = module.get<UserService>(UserService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  describe('validate', () => {
    it('should return user payload if user is found', async () => {
      const payload = { sub: 'uuid-123' };
      const user = { id: 'uuid-123', email: 'test@example.com' };

      mockUserService.findById.mockResolvedValue(user);

      const result = await strategy.validate(payload);

      expect(mockUserService.findById).toHaveBeenCalledWith('uuid-123');
      expect(result).toEqual({ id: 'uuid-123', email: 'test@example.com' });
    });

    it('should throw UnauthorizedException if user is not found', async () => {
      const payload = { sub: 'uuid-123' };

      mockUserService.findById.mockResolvedValue(null);

      await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
      expect(mockUserService.findById).toHaveBeenCalledWith('uuid-123');
    });
  });
});
