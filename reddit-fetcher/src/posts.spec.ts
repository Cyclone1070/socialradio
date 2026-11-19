import { parseTopPosts } from './posts';

const feed = (posts: string) => `<shreddit-feed>${posts}</shreddit-feed>`;

const post = (attrs: string) =>
  `<shreddit-post ${attrs}><div slot="title"></div></shreddit-post>`;

describe('parseTopPosts', () => {
  it('maps rendered post attributes in document order', () => {
    const html = feed(
      post(
        'id="t3_abc" post-title="First" author="alice" score="123" created-timestamp="2026-11-13T00:00:00.000000+0000" permalink="/r/x/comments/abc/first/"',
      ) +
        post(
          'id="t3_def" post-title="Second" author="bob" score="7" created-timestamp="2026-11-14T00:00:00.000000+0000" permalink="/r/x/comments/def/second/"',
        ),
    );

    expect(parseTopPosts(html)).toEqual([
      {
        id: 'abc',
        title: 'First',
        selftext: '',
        author: 'alice',
        score: 123,
        created_utc: 1794528000,
      },
      {
        id: 'def',
        title: 'Second',
        selftext: '',
        author: 'bob',
        score: 7,
        created_utc: 1794614400,
      },
    ]);
  });

  it('drops posts without an id or title', () => {
    const html = feed(
      post('id="t3_abc" post-title="" author="a" score="1"') +
        post('post-title="No id" author="a" score="1"'),
    );

    expect(parseTopPosts(html)).toEqual([]);
  });
});

describe('parseTopPosts body', () => {
  it('reads the rendered body when the feed carries one', () => {
    const posts = parseTopPosts(
      '<shreddit-post id="t3_a" post-title="T"><div slot="text-body"><p>One.</p><p>Two.</p></div></shreddit-post>',
    );

    expect(posts[0].selftext).toBe('One. Two.');
  });
});
