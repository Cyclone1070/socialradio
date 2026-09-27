import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AuthService } from './auth.service';
import { UserService } from './user.service';

describe('AuthService', () => {
  let service: AuthService;

  const mockUserService = {
    create: jest.fn(),
    findByEmail: jest.fn(),
  };

  const mockJwtService = {
    sign: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UserService, useValue: mockUserService },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('login', () => {
    it('should return access token if credentials are valid', async () => {
      const loginDto = {
        email: 'admin@socialradio.com',
        password: 'password123',
      };
      const user = {
        id: 'uuid',
        email: 'admin@socialradio.com',
        role: 'user' as const,
        verifyPassword: jest.fn().mockResolvedValue(true),
      };

      mockUserService.findByEmail.mockResolvedValue(user);
      mockJwtService.sign.mockReturnValue('signed_jwt');

      const result = await service.login(loginDto);

      expect(mockUserService.findByEmail).toHaveBeenCalledWith(loginDto.email);
      expect(user.verifyPassword).toHaveBeenCalledWith(loginDto.password);
      expect(mockJwtService.sign).toHaveBeenCalledWith({
        sub: user.id,
        role: 'user',
      });
      expect(result).toEqual({ accessToken: 'signed_jwt' });
    });

    it('logs the userId on a successful login', async () => {
      const user = {
        id: 'uuid',
        email: 'admin@socialradio.com',
        role: 'user' as const,
        verifyPassword: jest.fn().mockResolvedValue(true),
      };
      mockUserService.findByEmail.mockResolvedValue(user);
      mockJwtService.sign.mockReturnValue('signed_jwt');

      const infoSpy = jest
        .spyOn(PinoLogger.prototype, 'info')
        .mockImplementation(() => {});

      await service.login({
        email: 'admin@socialradio.com',
        password: 'password123',
      });

      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'uuid' }),
        expect.stringContaining('login'),
      );
    });

    it('warns with email + reason on a failed login', async () => {
      const user = {
        id: 'uuid',
        email: 'admin@socialradio.com',
        verifyPassword: jest.fn().mockResolvedValue(false),
      };
      mockUserService.findByEmail.mockResolvedValue(user);

      const warnSpy = jest
        .spyOn(PinoLogger.prototype, 'warn')
        .mockImplementation(() => {});

      await expect(
        service.login({
          email: 'admin@socialradio.com',
          password: 'wrong',
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'admin@socialradio.com',
          reason: expect.stringContaining('credentials') as string,
        }),
        expect.stringContaining('login'),
      );
    });

    it('should throw UnauthorizedException if user is not found', async () => {
      const loginDto = {
        email: 'notfound@example.com',
        password: 'password123',
      };

      mockUserService.findByEmail.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockUserService.findByEmail).toHaveBeenCalledWith(loginDto.email);
    });

    it('should throw UnauthorizedException if password does not match', async () => {
      const loginDto = {
        email: 'admin@socialradio.com',
        password: 'wrongpassword',
      };
      const user = {
        id: 'uuid',
        email: 'admin@socialradio.com',
        verifyPassword: jest.fn().mockResolvedValue(false),
      };

      mockUserService.findByEmail.mockResolvedValue(user);

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockUserService.findByEmail).toHaveBeenCalledWith(loginDto.email);
      expect(user.verifyPassword).toHaveBeenCalledWith(loginDto.password);
      expect(mockJwtService.sign).not.toHaveBeenCalled();
    });
  });
});
