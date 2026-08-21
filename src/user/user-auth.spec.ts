import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@mikro-orm/nestjs';
import { EntityManager } from '@mikro-orm/postgresql';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UserSchema } from '../infrastructure/database/schemas/user.schema';
import { UserService } from './user.service';
import { AuthService } from './auth.service';

describe('User & Auth Integration', () => {
  let userService: UserService;
  let authService: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        AuthService,
        {
          provide: getRepositoryToken(UserSchema),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: EntityManager,
          useValue: { persistAndFlush: jest.fn() },
        },
        {
          provide: JwtService,
          useValue: { sign: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
      ],
    }).compile();

    userService = module.get<UserService>(UserService);
    authService = module.get<AuthService>(AuthService);
  });

  it('should instantiate both UserService and AuthService in user domain', () => {
    expect(userService).toBeDefined();
    expect(authService).toBeDefined();
  });
});
