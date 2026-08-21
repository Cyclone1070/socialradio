import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScriptService } from './script.service';
import { LlmService } from './llm.service';
import { ScriptContract } from '../domain/contracts';

@Module({
  imports: [ConfigModule],
  providers: [
    LlmService,
    ScriptService,
    {
      provide: ScriptContract,
      useClass: ScriptService,
    },
  ],
  exports: [ScriptService, ScriptContract],
})
export class ScriptModule {}
