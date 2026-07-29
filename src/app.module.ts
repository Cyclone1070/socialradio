import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DomainModule } from './domain/domain.module';
import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';
import { MediaModule } from './media/media.module';
import { FeedModule } from './feed/feed.module';
import { RadioModule } from './radio/radio.module';
import { ChannelModule } from './channel/channel.module';
import { HealthcheckModule } from './healthcheck/healthcheck.module';
import { InitialSeed1700000000000 } from './database/migrations/1700000000000-InitialSeed';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => {
        const databaseUrl = config.get<string>('DATABASE_URL');
        if (!databaseUrl) {
          throw new Error('DATABASE_URL is not configured');
        }
        return {
          type: 'postgres',
          url: databaseUrl,
          autoLoadEntities: true,
          synchronize: true,
          migrationsRun: true,
          migrations: [InitialSeed1700000000000],
        };
      },
      inject: [ConfigService],
    }),
    DomainModule,
    UserModule,
    AuthModule,
    MediaModule,
    FeedModule,
    RadioModule,
    ChannelModule,
    HealthcheckModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
