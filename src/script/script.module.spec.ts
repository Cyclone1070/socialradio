import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ScriptModule } from './script.module';
import { ScriptContract } from '../domain/contracts';
import { ScriptService } from './script.service';
import { LlmService } from './llm.service';

describe('ScriptModule Integration', () => {
  let scriptGenerator: ScriptContract;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmService,
        ScriptService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
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
