import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DomainModule } from './domain/domain.module';
import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';
import { MediaModule } from './media/media.module';
import { FeedModule } from './feed/feed.module';
import { LlmModule } from './llm/llm.module';
import { RadioModule } from './radio/radio.module';
import { ChannelModule } from './channel/channel.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get<string>('DB_USERNAME', 'postgres'),
        password: config.get<string>('DB_PASSWORD', 'postgres'),
        database: config.get<string>('DB_DATABASE', 'socialradio'),
        autoLoadEntities: true,
        synchronize: true, // safe for local dev
      }),
      inject: [ConfigService],
    }),
    DomainModule,
    UserModule,
    AuthModule,
    MediaModule,
    FeedModule,
    LlmModule,
    RadioModule,
    ChannelModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
