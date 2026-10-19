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

const GREETING = `Dave: Welcome back to the show, everyone.
Caller: Thanks Dave! My roommate wants 70% of the rent.
Sarah: 70%? Is his room a broom closet?
Dave: If the lease says 50/50, he cannot change it.
Sarah: Did he lose his job recently?
Caller: Actually yeah, two weeks ago!`;

const COMPLIANT = `Dave: Before the break, Alex told us about the rent split.
Caller: Thanks Dave! My roommate wants 70% of the rent.
Sarah: 70%? Is his room a broom closet?
Dave: If the lease says 50/50, he cannot change it.
Sarah: Did he lose his job recently?
Caller: Actually yeah, two weeks ago!`;

const POSTS: PostData[] = [
  {
    id: 'post-1',
    subredditId: 'sub-1',
    redditId: 'r1',
    title: 'Roommate wants 70% of the rent',
    body: 'Body',
    score: 10,
  },
];

function serviceReturning(...answers: string[]): {
  service: ScriptService;
  llm: { generateText: jest.Mock };
} {
  const generateText = jest.fn();
  let call = 0;
  generateText.mockImplementation(() =>
    Promise.resolve(call++ === 0 ? OUTLINE : (answers.shift() ?? '')),
  );
  return {
    service: new ScriptService({ generateText } as unknown as LlmService),
    llm: { generateText },
  };
}

describe('a conversation that opens with the wrong thing', () => {
  it('is asked again, and the second opening is the one that airs', async () => {
    const { service, llm } = serviceReturning(GREETING, COMPLIANT);

    const result = await service.generateScript(
      POSTS,
      [],
      'Pick up where the last conversation left off.',
      'pick-up-the-thread',
    );

    expect(llm.generateText).toHaveBeenCalledTimes(3);
    expect(result.turns[0].text).toContain('Before the break');
  });

  it('is refused when it opens with the wrong thing twice', async () => {
    const { service } = serviceReturning(GREETING, GREETING);

    const result = await service.generateScript(
      POSTS,
      [],
      'Pick up where the last conversation left off.',
      'pick-up-the-thread',
    );

    expect('rejected' in result && result.rejected).toBe(true);
    expect('rejected' in result && result.reason).toContain('opening');
  });
});
