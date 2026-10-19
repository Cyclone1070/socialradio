import { ScriptService } from './script.service';
import { LlmService } from './llm.service';
import { PostData } from '../domain';

const OUTLINE = `# OUTLINE
## STEP 1: HOST INTRO & HOOK
- Hook Angle: rent

## STEP 2: CALLER NARRATIVE BEATS
- Alex explains

## STEP 3: ROOM STANCES
- Dave's Angle: lease terms

## STEP 4: VERDICT & OUTRO
- Verdict: stick to 55/45`;

const DIALOGUE = `Dave: Next up, we have Alex on Line 2.
Caller: Hey Dave! My roommate wants 70% of the rent.
Sarah: 70%? Is his room a broom closet?
Dave: If the lease says 50/50, he cannot change it.
Sarah: Did he lose his job recently?
Caller: Actually yeah, two weeks ago!
Dave: Stick to 55/45. Good luck mate!`;

describe('the continuity directive', () => {
  it('is handed to the dialogue stage, because that is where the opening is written', async () => {
    const llmService = {
      generateText: jest
        .fn()
        .mockResolvedValueOnce(OUTLINE)
        .mockResolvedValueOnce(DIALOGUE),
    };
    const service = new ScriptService(llmService as unknown as LlmService);
    const posts: PostData[] = [
      {
        id: 'post-1',
        subredditId: 'sub-1',
        redditId: 'r1',
        title: 'Roommate wants 70% of the rent',
        body: 'Body',
        score: 10,
      },
    ];

    await service.generateScript(posts, [], 'DIRECTIVE HERE');

    expect(llmService.generateText).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.stringContaining('DIRECTIVE HERE'),
    );
  });
});
