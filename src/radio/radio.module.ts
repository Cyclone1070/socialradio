import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { TopicScript } from './entities/topic-script.entity';
import { TopicAudio } from './entities/topic-audio.entity';
import { ScriptService } from './script.service';
import { AudioService } from './audio.service';
import { RadioService } from './radio.service';
import { LlmModule } from '../llm/llm.module';
import { DomainModule } from '../domain/domain.module';
import { FeedModule } from '../feed/feed.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TopicScript, TopicAudio]),
    LlmModule,
    DomainModule,
    HttpModule,
    FeedModule,
    StorageModule,
  ],
  providers: [ScriptService, AudioService, RadioService],
  exports: [RadioService, TypeOrmModule],
})
export class RadioModule {}
