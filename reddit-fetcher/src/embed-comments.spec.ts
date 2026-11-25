import { fetchEmbeddedComments, parseEmbeddedComments } from './embed-comments';

const comment = (
  id: string,
  body: string,
  opts: { child?: string; score?: string; ago?: string; author?: string } = {},
) => `
  <div class="reddit-link even first-half thing id-t1_${id}">
    <small>
      <a href="https://www.reddit.com/r/test/user/${opts.author ?? 'alice'}"><b>${opts.author ?? 'alice'}</b></a>
      <span id="score_t1_${id}">${opts.score ?? '12 points'}</span>
      ${opts.ago ?? '2 days ago'}
      <a href="https://www.reddit.com/r/test/comments/p1/title/${id}/">permalink</a>
    </small>
    <div class="md"><p>${body}</p></div>
    ${opts.child ?? ''}
  </div>`;

const rawPayload = (inner: string) =>
  `/**/document.write(${JSON.stringify(inner)});`;

describe('parseEmbeddedComments', () => {
  const now = 1_800_000_000;

  it('parses nested comments, scores, bodies and parents', () => {
    const html = rawPayload(
      comment('c1', 'parent body', {
        child: comment('c2', 'child body', {
          score: '3 points',
          ago: '1 day ago',
        }),
      }),
    );

    const parsed = parseEmbeddedComments(html, 'p1', now);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      id: 'c1',
      body: 'parent body',
      author: 'alice',
      score: 12,
      parent_id: 'p1',
      created_utc: now - 2 * 86_400,
    });
    expect(parsed[1]).toMatchObject({
      id: 'c2',
      body: 'child body',
      score: 3,
      parent_id: 'c1',
      created_utc: now - 86_400,
    });
  });

  it('treats hidden scores as zero and joins block text', () => {
    const html = rawPayload(
      comment('c1', 'one</p><p>two', { score: '[score hidden]' }),
    );

    const [parsed] = parseEmbeddedComments(html, 'p1', now);

    expect(parsed.score).toBe(0);
    expect(parsed.body).toBe('one two');
  });

  it('drops empty bodies and duplicate ids, then applies the cap', () => {
    const html = rawPayload(
      comment('c1', 'first') +
        comment('c1', 'duplicate') +
        comment('c2', '   '),
    );

    const parsed = parseEmbeddedComments(html, 'p1', now, 1);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ id: 'c1', body: 'first' });
  });
});

describe('fetchEmbeddedComments', () => {
  it('returns comments and the remaining quota', async () => {
    const html = rawPayload(comment('c1', 'hello'));
    const fetchImpl = jest.fn(() =>
      Promise.resolve({
        status: 200,
        ok: true,
        headers: {
          get: (name: string) =>
            name === 'x-ratelimit-remaining' ? '88' : null,
        },
        text: () => Promise.resolve(html),
      }),
    );

    const result = await fetchEmbeddedComments('test', 'p1', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: 1_800_000_000,
    });

    const [requestedUrl] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(requestedUrl).toBe(
      'https://www.reddit.com/r/test/comments/p1/.embed?limit=500',
    );
    expect(result.comments).toHaveLength(1);
    expect(result.remaining).toBe(88);
  });

  it('times out a hung embed request', async () => {
    const fetchImpl = jest.fn(
      () => new Promise<never>(() => undefined) as Promise<Response>,
    );

    await expect(
      fetchEmbeddedComments('test', 'p1', {
        fetchImpl,
        timeoutMs: 25,
      }),
    ).rejects.toThrow(/timed out/);
  });

  it('throws a typed error on a rejected embed request', async () => {
    const fetchImpl = jest.fn(() =>
      Promise.resolve({
        status: 429,
        ok: false,
        headers: { get: () => '0' },
        text: () => Promise.resolve('slow down'),
      }),
    );

    await expect(
      fetchEmbeddedComments('test', 'p1', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ status: 429 });
  });
});
