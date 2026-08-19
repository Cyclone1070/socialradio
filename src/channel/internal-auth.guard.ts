import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class InternalAuthGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const expectedSecret = this.configService.get<string>(
      'INTERNAL_SERVICE_SECRET',
    );
    const providedToken = request.headers['x-internal-token'];

    if (!expectedSecret || !providedToken || providedToken !== expectedSecret) {
      throw new UnauthorizedException('Invalid internal service credentials');
    }

    return true;
  }
}
