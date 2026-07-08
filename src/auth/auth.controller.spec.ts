import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RegisterDto } from '../user/dto/register.dto';
import { LoginDto } from './dto/login.dto';

describe('AuthController', () => {
  let controller: AuthController;
  let service: AuthService;

  const mockAuthService = {
    register: jest.fn(),
    login: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('register', () => {
    it('should register a new user and return response', async () => {
      const registerDto: RegisterDto = { email: 'test@example.com', password: 'password123' };
      const createdUser = { id: 'uuid', email: 'test@example.com', createdAt: new Date() };

      mockAuthService.register.mockResolvedValue(createdUser);

      const result = await (controller as any).register(registerDto);

      expect(mockAuthService.register).toHaveBeenCalledWith(registerDto);
      expect(result).toEqual(createdUser);
    });
  });

  describe('login', () => {
    it('should login user and return token response', async () => {
      const loginDto: LoginDto = { email: 'test@example.com', password: 'password123' };
      const tokenResponse = { accessToken: 'jwt_token' };

      mockAuthService.login.mockResolvedValue(tokenResponse);

      const result = await (controller as any).login(loginDto);

      expect(mockAuthService.login).toHaveBeenCalledWith(loginDto);
      expect(result).toEqual(tokenResponse);
    });
  });
});
