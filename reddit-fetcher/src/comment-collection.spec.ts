import {
  collectComments,
  isPartialCommentRender,
  shouldResumeForWordGuard,
} from './comment-collection';

const tree = (n: number) => ({
  html: Array.from(
    { length: n },
    (_, i) =>
      `<shreddit-comment thingid="t1_c${i}" author="a${i}" score="${n - i}" created="2026-11-13T00:00:00.000000+0000" depth="0"><div slot="comment">body ${i}</div></shreddit-comment>`,
  ).join(''),
  count: n,
});

function makeReader() {
  return {
    readTree: jest.fn(),
    readCount: jest.fn().mockResolvedValue(2),
    clickMoreBatch: jest.fn().mockResolvedValue(0),
    waitForGrowth: jest.fn().mockResolvedValue(false),
  };
}

const opts = {
  postId: 'post1',
  settleMs: 0,
};

const chainTree = (n: number) => {
  const build = (index: number): string =>
    index < 0
      ? ''
      : `<shreddit-comment thingid="t1_c${index}" author="a" score="${n - index}" created="2026-11-13T00:00:00.000000+0000" depth="${index}"><div slot="comment">body ${index}</div><div id="comment-children">${build(index - 1)}</div></shreddit-comment>`;
  return { html: build(n - 1), count: n };
};

describe('isPartialCommentRender', () => {
  it('flags a 25-comment render of an 853-comment thread', () => {
    expect(
      isPartialCommentRender({ collected: 25, expected: 853, softCap: 300 }),
    ).toBe(true);
    expect(
      isPartialCommentRender({ collected: 300, expected: 853, softCap: 300 }),
    ).toBe(false);
    expect(
      isPartialCommentRender({ collected: 25, expected: 50, softCap: 300 }),
    ).toBe(false);
    expect(
      isPartialCommentRender({ collected: 50, expected: 131, softCap: 250 }),
    ).toBe(false);
    expect(
      isPartialCommentRender({ collected: 250, expected: 1_648, softCap: 250 }),
    ).toBe(false);
  });
});

describe('shouldResumeForWordGuard', () => {
  it('resumes only when the soft cap was hit before the word guard', () => {
    expect(
      shouldResumeForWordGuard({
        collected: 300,
        softCap: 300,
        words: 2_000,
        minWords: 2_500,
      }),
    ).toBe(true);
    expect(
      shouldResumeForWordGuard({
        collected: 300,
        softCap: 300,
        words: 4_000,
        minWords: 2_500,
      }),
    ).toBe(false);
    expect(
      shouldResumeForWordGuard({
        collected: 120,
        softCap: 300,
        words: 2_000,
        minWords: 2_500,
      }),
    ).toBe(false);
  });
});

describe('collectComments', () => {
  it('returns the rendered comments when there is no more control', async () => {
    const reader = makeReader();
    reader.readTree.mockResolvedValue(tree(2));
    reader.clickMoreBatch.mockResolvedValue(0);

    const { comments } = await collectComments(reader, opts);

    expect(comments.map((c) => c.id)).toEqual(['c0', 'c1']);
    expect(reader.clickMoreBatch).toHaveBeenCalledTimes(4);
  });

  it('does not sleep when the click grows the tree immediately', async () => {
    const reader = makeReader();
    reader.readTree.mockResolvedValueOnce(tree(1)).mockResolvedValue(tree(3));
    reader.readCount.mockResolvedValueOnce(3);
    reader.clickMoreBatch.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    reader.waitForGrowth
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const startedAt = Date.now();
    await collectComments(reader, opts);

    expect(reader.waitForGrowth).toHaveBeenCalledWith(1, 2000);
    expect(Date.now() - startedAt).toBeLessThan(200);
  });

  it('follows expansions until the control disappears', async () => {
    const reader = makeReader();
    reader.readTree.mockResolvedValueOnce(tree(1)).mockResolvedValue(tree(3));
    reader.readCount.mockResolvedValueOnce(2).mockResolvedValueOnce(3);
    reader.clickMoreBatch
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);

    const { comments } = await collectComments(reader, opts);

    expect(comments).toHaveLength(3);
    expect(reader.clickMoreBatch).toHaveBeenCalledTimes(7);
  });

  it('stops cleanly when the caller reports quota exhaustion', async () => {
    const reader = makeReader();
    reader.readTree.mockResolvedValue(tree(2));
    reader.clickMoreBatch.mockResolvedValue(0);
    let checks = 0;

    const result = await collectComments(reader, {
      ...opts,
      shouldStop: () => {
        checks += 1;
        return checks > 1;
      },
    });

    expect(result.comments).toHaveLength(2);
  });

  it('fails fast when controls exist but the tree never grows', async () => {
    const reader = makeReader();
    reader.readTree.mockResolvedValue(tree(1));
    reader.readCount.mockResolvedValue(1);
    reader.clickMoreBatch.mockResolvedValue(1);
    reader.waitForGrowth.mockResolvedValue(false);

    await expect(collectComments(reader, opts)).rejects.toThrow(
      /stopped expanding/,
    );
    expect(reader.clickMoreBatch).toHaveBeenCalledTimes(3);
  });

  it('reports rendered and expanded counts', async () => {
    const reader = makeReader();
    reader.readTree
      .mockResolvedValueOnce(tree(1))
      .mockResolvedValueOnce(tree(3));
    reader.clickMoreBatch.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    const result = await collectComments(reader, opts);

    expect(result.renderedCount).toBe(1);
    expect(result.expandedCount).toBe(2);
  });

  it('reports how long the continuation phase took', async () => {
    const reader = makeReader();
    reader.readTree.mockResolvedValue(tree(2));
    const onPhase = jest.fn();

    await collectComments(reader, {
      ...opts,
      collectContinuations: jest.fn().mockResolvedValue([]),
      onPhase,
    });

    expect(onPhase).toHaveBeenCalledWith('continuation', expect.any(Number));
  });

  it('skips continuations when the inline chain is already deep', async () => {
    const reader = makeReader();
    reader.readTree.mockResolvedValue(chainTree(3));
    const collectContinuations = jest.fn();

    await collectComments(reader, {
      ...opts,
      continuationsOnlyBelowChainDepth: 3,
      collectContinuations,
    });

    expect(collectContinuations).not.toHaveBeenCalled();
  });

  it('runs continuations when the inline chain is shallow', async () => {
    const reader = makeReader();
    reader.readTree.mockResolvedValue(tree(2));
    const collectContinuations = jest.fn().mockResolvedValue([]);

    await collectComments(reader, {
      ...opts,
      continuationsOnlyBelowChainDepth: 3,
      collectContinuations,
    });

    expect(collectContinuations).toHaveBeenCalledTimes(1);
  });

  it('skips continuations when enough inline comments were collected', async () => {
    const reader = makeReader();
    reader.readTree.mockResolvedValue(tree(250));
    const collectContinuations = jest.fn();

    await collectComments(reader, {
      ...opts,
      minInlineForContinuations: 200,
      collectContinuations,
    });

    expect(collectContinuations).not.toHaveBeenCalled();
  });

  it('runs continuations when inline comments are thin', async () => {
    const reader = makeReader();
    reader.readTree.mockResolvedValue(tree(50));
    const collectContinuations = jest.fn().mockResolvedValue([]);

    await collectComments(reader, {
      ...opts,
      minInlineForContinuations: 200,
      collectContinuations,
    });

    expect(collectContinuations).toHaveBeenCalledTimes(1);
  });

  it('skips continuations when the cap is already met', async () => {
    const reader = makeReader();
    reader.readTree.mockResolvedValue(tree(5));
    const collectContinuations = jest.fn();

    await collectComments(reader, { ...opts, cap: 5, collectContinuations });

    expect(collectContinuations).not.toHaveBeenCalled();
  });

  it('merges continuation comments when provided', async () => {
    const reader = makeReader();
    reader.readTree.mockResolvedValue(tree(2));
    reader.clickMoreBatch.mockResolvedValue(0);
    const collectContinuations = jest.fn().mockResolvedValue([
      {
        id: 'x1',
        body: 'deep',
        author: 'a',
        score: 1,
        parent_id: 'c0',
        created_utc: 5,
      },
    ]);

    const { comments } = await collectComments(reader, {
      ...opts,
      collectContinuations,
    });

    expect(comments.map((c) => c.id)).toContain('x1');
    expect(collectContinuations).toHaveBeenCalledTimes(1);
  });

  it('keeps inline comments when continuation collection fails', async () => {
    const reader = makeReader();
    reader.readTree.mockResolvedValue(tree(2));
    reader.clickMoreBatch.mockResolvedValue(0);
    const collectContinuations = jest
      .fn()
      .mockRejectedValue(new Error('continuation died'));

    const { comments } = await collectComments(reader, {
      ...opts,
      collectContinuations,
    });

    expect(comments).toHaveLength(2);
  });

  it('does not click when the cap is already met', async () => {
    const reader = makeReader();
    reader.readTree.mockResolvedValue(tree(5));

    const { comments } = await collectComments(reader, { ...opts, cap: 5 });

    expect(comments).toHaveLength(5);
    expect(reader.clickMoreBatch).not.toHaveBeenCalled();
  });

  it('returns what it collected when a click fails', async () => {
    const reader = makeReader();
    reader.readTree.mockResolvedValue(tree(2));
    reader.clickMoreBatch.mockRejectedValue(new Error('page died'));

    const { comments } = await collectComments(reader, opts);
    expect(comments).toHaveLength(2);
  });

  it('returns at least 25 rendered comments when the first click fails', async () => {
    const reader = makeReader();
    reader.readTree.mockResolvedValue(tree(30));
    reader.clickMoreBatch.mockRejectedValue(new Error('page died'));

    const { comments } = await collectComments(reader, opts);

    expect(comments.length).toBeGreaterThanOrEqual(25);
  });

  it('fails loudly when the initial tree read fails', async () => {
    const reader = makeReader();
    reader.readTree.mockRejectedValue(new Error('page died'));

    await expect(collectComments(reader, opts)).rejects.toThrow('page died');
  });

  it('returns an empty list for a thread with no comments', async () => {
    const reader = makeReader();
    reader.readTree.mockResolvedValue({ html: '', count: 0 });
    reader.clickMoreBatch.mockResolvedValue(0);

    const { comments } = await collectComments(reader, opts);

    expect(comments).toEqual([]);
  });

  it('returns exactly the cap when more comments are expandable', async () => {
    const reader = makeReader();
    reader.readTree.mockResolvedValue(tree(60));

    const { comments } = await collectComments(reader, { ...opts, cap: 50 });

    expect(comments).toHaveLength(50);
  });

  it('stops after the read that crosses the deadline', async () => {
    let clock = 0;
    const reader = makeReader();
    reader.readTree.mockResolvedValue(tree(2));
    reader.readCount.mockImplementation(() => {
      clock = 100;
      return Promise.resolve(2);
    });
    reader.clickMoreBatch.mockResolvedValue(1);

    await collectComments(reader, {
      ...opts,
      budgetMs: 10,
      now: () => clock,
    });

    expect(reader.clickMoreBatch).toHaveBeenCalledTimes(1);
  });

  it('stops when no expansion control remains', async () => {
    const reader = makeReader();
    reader.readTree.mockResolvedValue(tree(2));
    reader.clickMoreBatch
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);

    await collectComments(reader, opts);

    expect(reader.clickMoreBatch).toHaveBeenCalledTimes(5);
  });

  it('does not click once the budget is exhausted', async () => {
    const reader = makeReader();
    reader.readTree.mockResolvedValue(tree(1));

    await collectComments(reader, { ...opts, budgetMs: 0 });

    expect(reader.clickMoreBatch).not.toHaveBeenCalled();
  });
});

describe('collectComments regression guards', () => {
  it('does not sleep after a growth timeout', async () => {
    const reader = makeReader();
    reader.readTree.mockResolvedValue(tree(1));
    reader.readCount.mockResolvedValue(1);
    reader.clickMoreBatch.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    reader.waitForGrowth.mockResolvedValue(false);

    const result = await collectComments(reader, {
      postId: 'post1',
      settleMs: 500,
    });

    expect(result.timings.settleMs).toBe(0);
  });

  it('does not sleep on rounds where nothing was clicked', async () => {
    const reader = makeReader();
    reader.readTree.mockResolvedValue(tree(2));
    reader.readCount.mockResolvedValue(2);
    reader.clickMoreBatch.mockResolvedValue(0);

    const result = await collectComments(reader, {
      postId: 'post1',
      settleMs: 500,
    });

    expect(result.timings.settleMs).toBe(0);
  });

  it('returns every comment from a large batch-driven tree without duplicates', async () => {
    const total = 260;
    const reader = makeReader();
    reader.readTree
      .mockResolvedValueOnce(tree(25))
      .mockResolvedValue(tree(total));
    reader.readCount.mockImplementation(() => {
      const current = reader.clickMoreBatch.mock.calls.length * 32 + 25;
      return Promise.resolve(Math.min(total, current));
    });
    reader.clickMoreBatch.mockImplementation(() => {
      const clickedRounds = reader.clickMoreBatch.mock.calls.length;
      return Promise.resolve(25 + clickedRounds * 32 < total ? 32 : 0);
    });
    reader.waitForGrowth.mockResolvedValue(true);

    const result = await collectComments(reader, {
      postId: 'post1',
      settleMs: 0,
      cap: 500,
    });

    const ids = result.comments.map((comment) => comment.id);
    expect(result.comments).toHaveLength(total);
    expect(new Set(ids).size).toBe(total);
    expect(result.comments.every((comment) => comment.body.length > 0)).toBe(
      true,
    );
  });
});
