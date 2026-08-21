import { Injectable, ConflictException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository, EntityManager } from '@mikro-orm/postgresql';
import { User } from './entities/user.entity';
import { UserSchema } from '../infrastructure/database/schemas/user.schema';
import { RegisterDto } from './dto/register.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { createServiceLogger } from '../infrastructure/logging/logging.module';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UserService implements OnModuleInit {
  private readonly logger = createServiceLogger(UserService.name);

  constructor(
    @InjectRepository(UserSchema)
    private readonly userRepo: EntityRepository<User>,
    private readonly em: EntityManager,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const adminEmail = this.configService.get<string>('ADMIN_EMAIL');
    const adminPassword = this.configService.get<string>('ADMIN_PASSWORD');

    if (!adminEmail || !adminPassword) {
      return;
    }

    const em = this.em.fork();
    const existing = await em.findOne(UserSchema, { email: adminEmail });
    if (!existing) {
      const hash = await bcrypt.hash(adminPassword, 10);
      const admin = new User();
      admin.email = adminEmail;
      admin.passwordHash = hash;
      admin.role = 'admin';
      await em.persist(admin).flush();
      this.logger.info({ email: adminEmail }, 'admin user seeded');
    }
  }

  async create(
    dto: RegisterDto,
    passwordHash: string,
  ): Promise<UserResponseDto> {
    const existing = await this.userRepo.findOne({ email: dto.email });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const user = new User();
    user.email = dto.email;
    user.passwordHash = passwordHash;

    await this.em.persist(user).flush();

    this.logger.info({ userId: user.id }, 'user registered');

    return {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt,
    };
  }

  async findById(id: string): Promise<User | null> {
    return this.userRepo.findOne({ id });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepo.findOne({ email });
  }
}
