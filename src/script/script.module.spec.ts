import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { ScriptModule } from './script.module';
import { ScriptContract } from '../domain/contracts';
import { ScriptService } from './script.service';
import { DeepSeekLlmService } from './deepseek-llm.service';
import { LlmService } from './llm-service';
import { TopicScript } from './entities/topic-script.entity';

describe('ScriptModule Integration', () => {
  let scriptGenerator: ScriptContract;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScriptService,
        DeepSeekLlmService,
        {
          provide: LlmService,
          useExisting: DeepSeekLlmService,
        },
        {
          provide: HttpService,
          useValue: { post: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
        {
          provide: getRepositoryToken(TopicScript),
          useValue: { findOneBy: jest.fn() },
        },
        {
          provide: ScriptContract,
          useClass: ScriptService,
        },
      ],
    }).compile();

    scriptGenerator = module.get<ScriptContract>(ScriptContract);
  });

  it('should export ScriptContract from ScriptModule', () => {
    expect(ScriptModule).toBeDefined();
    expect(scriptGenerator).toBeDefined();
  });
});
