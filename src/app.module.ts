import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { LoggingModule } from './infrastructure/logging/logging.module';

import { UserModule } from './user/user.module';
import { MediaModule } from './media/media.module';
import { ContentModule } from './content/content.module';
import { ScriptModule } from './script/script.module';
import { VoiceModule } from './voice/voice.module';
import { ChannelModule } from './channel/channel.module';
import { HealthcheckModule } from './infrastructure/healthcheck/healthcheck.module';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import mikroOrmConfig from './infrastructure/database/mikro-orm.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    LoggingModule.forRoot(),
    MikroOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => {
        const databaseUrl = config.get<string>('DATABASE_URL');
        return {
          ...mikroOrmConfig,
          driver: PostgreSqlDriver,
          clientUrl: databaseUrl || mikroOrmConfig.clientUrl,
        };
      },
      inject: [ConfigService],
    }),

    UserModule,
    MediaModule,
    ContentModule,
    ScriptModule,
    VoiceModule,
    ChannelModule,
    HealthcheckModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
