import { describeOpeningProblem } from './opening';

describe('the first line of a conversation', () => {
  it('refuses a welcome back when the thread was supposed to be picked up', () => {
    const problem = describeOpeningProblem(
      'pick-up-the-thread',
      'Welcome back, listeners. Now, where were we?',
    );

    expect(problem).toContain('pick up the thread');
  });

  it('accepts an opening that actually refers back', () => {
    expect(
      describeOpeningProblem(
        'pick-up-the-thread',
        'Dave: Before the break, Alex told us about the rent split.',
      ),
    ).toBeNull();
  });

  it('accepts a welcome back when the listeners really have been away', () => {
    expect(
      describeOpeningProblem(
        'welcome-back',
        "Dave: We're back, and still on the phone with Alex.",
      ),
    ).toBeNull();
  });

  it('refuses a show that has not started yet welcoming anyone back', () => {
    const problem = describeOpeningProblem(
      'open-the-show',
      'Sarah: Welcome back to the show, everyone.',
    );

    expect(problem).toContain('first conversation');
  });

  it('accepts a first greeting', () => {
    expect(
      describeOpeningProblem(
        'open-the-show',
        'Dave: Hello and welcome, first time callers especially.',
      ),
    ).toBeNull();
  });

  it('says nothing at all when no directive was given', () => {
    expect(describeOpeningProblem(undefined, 'Welcome back.')).toBeNull();
  });

  it('says nothing about an empty opening it cannot judge', () => {
    expect(describeOpeningProblem('pick-up-the-thread', '   ')).toBeNull();
  });
});
