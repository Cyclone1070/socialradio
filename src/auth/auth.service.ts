import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/user.service';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { createServiceLogger } from '../logging/logging.module';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  private readonly logger = createServiceLogger(AuthService.name);

  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.userService.findByEmail(dto.email);
    if (!user) {
      this.logger.warn(
        { email: dto.email, reason: 'no such user' },
        'login failed',
      );
      throw new UnauthorizedException('Invalid credentials');
    }

    const isMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isMatch) {
      this.logger.warn(
        { email: dto.email, reason: 'invalid credentials' },
        'login failed',
      );
      throw new UnauthorizedException('Invalid credentials');
    }

    // Successful logins are the auth audit trail — user id, no secrets.
    this.logger.info({ userId: user.id }, 'login succeeded');

    const accessToken = this.jwtService.sign({
      sub: user.id,
      role: user.role || 'user',
    });

    return { accessToken };
  }
}
