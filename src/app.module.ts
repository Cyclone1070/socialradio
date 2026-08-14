import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggingModule } from './infrastructure/logging/logging.module';

import { UserModule } from './user/user.module';
import { MediaModule } from './media/media.module';
import { ContentModule } from './content/content.module';
import { ScriptModule } from './script/script.module';
import { VoiceModule } from './voice/voice.module';
import { SegmentModule } from './segment/segment.module';
import { ChannelModule } from './channel/channel.module';
import { HealthcheckModule } from './infrastructure/healthcheck/healthcheck.module';
import { CreateSchema1785419900925 } from './infrastructure/database/migrations/1785419900925-CreateSchema';
import { AddScrapeStatusColumns1790000000000 } from './infrastructure/database/migrations/1790000000000-AddScrapeStatusColumns';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    LoggingModule.forRoot(),
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
          synchronize: false,
          migrationsRun: true,
          migrations: [
            CreateSchema1785419900925,
            AddScrapeStatusColumns1790000000000,
          ],
        };
      },
      inject: [ConfigService],
    }),

    UserModule,
    MediaModule,
    ContentModule,
    ScriptModule,
    VoiceModule,
    SegmentModule,
    ChannelModule,
    HealthcheckModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
