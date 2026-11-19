import { collectComments } from './comment-collection';

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
    clickMoreBatch: jest.fn().mockResolvedValue(0),
    waitForGrowth: jest.fn().mockResolvedValue(false),
  };
}

const opts = {
  postId: 'post1',
};

const chainTree = (n: number) => {
  const build = (index: number): string =>
    index < 0
      ? ''
      : `<shreddit-comment thingid="t1_c${index}" author="a" score="${n - index}" created="2026-11-13T00:00:00.000000+0000" depth="${index}"><div slot="comment">body ${index}</div><div id="comment-children">${build(index - 1)}</div></shreddit-comment>`;
  return { html: build(n - 1), count: n };
};

describe('collectComments', () => {
  it('returns the rendered comments when there is no more control', async () => {
    const reader = makeReader();
    reader.readTree.mockResolvedValue(tree(2));
    reader.clickMoreBatch.mockResolvedValue(0);

    const { comments } = await collectComments(reader, opts);

    expect(comments.map((c) => c.id)).toEqual(['c0', 'c1']);
    expect(reader.clickMoreBatch).toHaveBeenCalledTimes(1);
  });

  it('does not sleep when the click grows the tree immediately', async () => {
    const reader = makeReader();
    reader.readTree.mockResolvedValueOnce(tree(1)).mockResolvedValue(tree(3));
    reader.clickMoreBatch.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    reader.waitForGrowth
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const startedAt = Date.now();
    await collectComments(reader, opts);

    expect(reader.waitForGrowth).toHaveBeenCalledWith(1, 1500);
    expect(Date.now() - startedAt).toBeLessThan(200);
  });

  it('follows expansions until the control disappears', async () => {
    const reader = makeReader();
    reader.readTree
      .mockResolvedValueOnce(tree(1))
      .mockResolvedValueOnce(tree(2))
      .mockResolvedValueOnce(tree(3));
    reader.clickMoreBatch
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);

    const { comments } = await collectComments(reader, opts);

    expect(comments).toHaveLength(3);
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
    let reads = 0;
    const reader = makeReader();
    reader.readTree.mockImplementation(() => {
      reads += 1;
      if (reads > 1) clock = 100;
      return Promise.resolve(tree(2));
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

    expect(reader.clickMoreBatch).toHaveBeenCalledTimes(3);
  });

  it('does not click once the budget is exhausted', async () => {
    const reader = makeReader();
    reader.readTree.mockResolvedValue(tree(1));

    await collectComments(reader, { ...opts, budgetMs: 0 });

    expect(reader.clickMoreBatch).not.toHaveBeenCalled();
  });
});
