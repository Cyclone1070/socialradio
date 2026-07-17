import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { TopicScript } from './entities/topic-script.entity';
import { TopicAudio } from './entities/topic-audio.entity';
import { ScriptService } from './script.service';
import { AudioService } from './audio.service';
import { RadioService } from './radio.service';
import { DomainModule } from '../domain/domain.module';
import { FeedModule } from '../feed/feed.module';
import { StorageModule } from '../storage/storage.module';
import { DeepSeekLlmService } from './deepseek-llm.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TopicScript, TopicAudio]),
    DomainModule,
    HttpModule,
    FeedModule,
    StorageModule,
  ],
  providers: [
    ScriptService,
    AudioService,
    RadioService,
    {
      provide: 'LlmService',
      useClass: DeepSeekLlmService,
    },
  ],
  exports: [RadioService, 'LlmService', TypeOrmModule],
})
export class RadioModule {}
