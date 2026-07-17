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
          synchronize: true, // safe for local dev
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
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
