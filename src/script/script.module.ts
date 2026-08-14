import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TopicScript } from './entities/topic-script.entity';
import { ScriptService } from './script.service';
import { DeepSeekLlmService } from './deepseek-llm.service';
import { LlmService } from './llm-service';
import { ScriptContract } from '../domain/contracts';

@Module({
  imports: [TypeOrmModule.forFeature([TopicScript]), HttpModule],
  providers: [
    ScriptService,
    DeepSeekLlmService,
    {
      provide: LlmService,
      useExisting: DeepSeekLlmService,
    },
    {
      provide: ScriptContract,
      useClass: ScriptService,
    },
  ],
  exports: [ScriptService, ScriptContract, TypeOrmModule],
})
export class ScriptModule {}
