import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TopicScript } from './entities/topic-script.entity';
import { ScriptService } from './script.service';
import { LlmService } from './llm.service';
import { ScriptContract } from '../domain/contracts';

@Module({
  imports: [TypeOrmModule.forFeature([TopicScript]), ConfigModule],
  providers: [
    LlmService,
    ScriptService,
    {
      provide: ScriptContract,
      useClass: ScriptService,
    },
  ],
  exports: [ScriptService, ScriptContract, TypeOrmModule],
})
export class ScriptModule {}
