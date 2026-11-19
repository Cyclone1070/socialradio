import {
  finalizeComments,
  maxChainDepth,
  parseCommentTree,
  toRedditComment,
} from './comments';
import type { RedditCommentData } from './types';

const fixture = `
<div id="comment-tree">
  <shreddit-comment thingid="t1_aaa" author="alice" score="8708"
    created="2026-11-13T02:48:57.647000+0000" depth="0">
    <div slot="comment">Top <b>comment</b> here</div>
    <div id="comment-children">
      <shreddit-comment thingid="t1_bbb" author="bob" score="3990"
        created="2026-11-13T03:39:57.866000+0000" depth="1">
        <div slot="comment">  Reply
          text  </div>
      </shreddit-comment>
    </div>
  </shreddit-comment>
  <shreddit-comment thingid="t1_ccc" author="carol" score="12"
    created="2026-11-13T04:00:00.000000+0000" depth="0">
    <div slot="comment">Second top</div>
  </shreddit-comment>
</div>`;

describe('parseCommentTree', () => {
  it('returns comments in document order with nesting-derived parents', () => {
    expect(parseCommentTree(fixture)).toEqual([
      {
        thingId: 't1_aaa',
        author: 'alice',
        score: '8708',
        created: '2026-11-13T02:48:57.647000+0000',
        depth: 0,
        parentThingId: null,
        body: 'Top comment here',
      },
      {
        thingId: 't1_bbb',
        author: 'bob',
        score: '3990',
        created: '2026-11-13T03:39:57.866000+0000',
        depth: 1,
        parentThingId: 't1_aaa',
        body: 'Reply text',
      },
      {
        thingId: 't1_ccc',
        author: 'carol',
        score: '12',
        created: '2026-11-13T04:00:00.000000+0000',
        depth: 0,
        parentThingId: null,
        body: 'Second top',
      },
    ]);
  });
});

describe('toRedditComment', () => {
  it('normalizes ids, scores, timestamps and parents', () => {
    expect(
      toRedditComment(
        {
          thingId: 't1_aaa',
          author: 'alice',
          score: '8708',
          created: '2026-11-13T00:00:00.000000+0000',
          depth: 0,
          parentThingId: 't1_ppp',
          body: ' Hello  world ',
        },
        'post123',
      ),
    ).toEqual({
      id: 'aaa',
      body: 'Hello world',
      author: 'alice',
      score: 8708,
      parent_id: 'ppp',
      created_utc: 1794528000,
    });
  });

  it('keeps negative scores', () => {
    expect(
      toRedditComment(
        {
          thingId: 't1_neg',
          author: 'x',
          score: '-7',
          created: '2026-11-13T00:00:00.000000+0000',
          depth: 0,
          parentThingId: null,
          body: 'downvoted',
        },
        'post123',
      ).score,
    ).toBe(-7);
  });

  it('defaults invalid score and timestamp and parents top-level comments to the post', () => {
    expect(
      toRedditComment(
        {
          thingId: 't1_bbb',
          author: 'bob',
          score: 'not-a-number',
          created: '',
          depth: 0,
          parentThingId: null,
          body: 'x',
        },
        'post123',
      ),
    ).toEqual({
      id: 'bbb',
      body: 'x',
      author: 'bob',
      score: 0,
      parent_id: 'post123',
      created_utc: 0,
    });
  });
});

describe('paragraph separation', () => {
  it('joins block paragraphs with a space instead of running them together', () => {
    const [comment] = parseCommentTree(
      '<shreddit-comment thingid="t1_a" author="x" score="1" created="2026-11-13T00:00:00.000000+0000" depth="0"><div slot="comment"><p>First.</p><p>Second.</p></div></shreddit-comment>',
    );

    expect(comment.body).toBe('First. Second.');
  });
});

describe('maxChainDepth', () => {
  it('returns the longest parent chain ending at a comment', () => {
    const comments: RedditCommentData[] = [
      {
        id: 'a',
        body: 'A',
        author: 'x',
        score: 1,
        parent_id: 'post1',
        created_utc: 1,
      },
      {
        id: 'b',
        body: 'B',
        author: 'x',
        score: 1,
        parent_id: 'a',
        created_utc: 1,
      },
      {
        id: 'c',
        body: 'C',
        author: 'x',
        score: 1,
        parent_id: 'b',
        created_utc: 1,
      },
      {
        id: 'd',
        body: 'D',
        author: 'x',
        score: 1,
        parent_id: 'post1',
        created_utc: 1,
      },
    ];

    expect(maxChainDepth(comments, 'post1')).toBe(3);
  });

  it('returns 1 for only top-level comments and 0 for none', () => {
    const top: RedditCommentData[] = [
      {
        id: 'a',
        body: 'A',
        author: 'x',
        score: 1,
        parent_id: 'post1',
        created_utc: 1,
      },
    ];

    expect(maxChainDepth(top, 'post1')).toBe(1);
    expect(maxChainDepth([], 'post1')).toBe(0);
  });
});

describe('finalizeComments', () => {
  it('dedupes by id, drops empty bodies, sorts by score, recency and id, then caps', () => {
    const comments: RedditCommentData[] = [
      {
        id: 'a',
        body: 'A',
        author: 'x',
        score: 5,
        parent_id: 'post123',
        created_utc: 100,
      },
      {
        id: 'b',
        body: '',
        author: 'x',
        score: 99,
        parent_id: 'post123',
        created_utc: 100,
      },
      {
        id: 'c',
        body: 'C',
        author: 'x',
        score: 5,
        parent_id: 'post123',
        created_utc: 200,
      },
      {
        id: 'a',
        body: 'A dup',
        author: 'x',
        score: 5,
        parent_id: 'post123',
        created_utc: 100,
      },
      {
        id: 'd',
        body: 'D',
        author: 'x',
        score: 7,
        parent_id: 'post123',
        created_utc: 50,
      },
      {
        id: 'e',
        body: 'E',
        author: 'x',
        score: 5,
        parent_id: 'post123',
        created_utc: 200,
      },
    ];

    expect(finalizeComments(comments, 3, 'post123')).toEqual([
      {
        id: 'd',
        body: 'D',
        author: 'x',
        score: 7,
        parent_id: 'post123',
        created_utc: 50,
      },
      {
        id: 'c',
        body: 'C',
        author: 'x',
        score: 5,
        parent_id: 'post123',
        created_utc: 200,
      },
      {
        id: 'e',
        body: 'E',
        author: 'x',
        score: 5,
        parent_id: 'post123',
        created_utc: 200,
      },
    ]);
  });

  it('drops comments without an author or a positive timestamp', () => {
    const comments: RedditCommentData[] = [
      {
        id: 'a',
        body: 'A',
        author: '',
        score: 5,
        parent_id: 'post123',
        created_utc: 100,
      },
      {
        id: 'b',
        body: 'B',
        author: 'x',
        score: 5,
        parent_id: 'post123',
        created_utc: 0,
      },
      {
        id: 'c',
        body: 'C',
        author: 'x',
        score: 5,
        parent_id: 'post123',
        created_utc: 100,
      },
    ];

    expect(finalizeComments(comments, 10, 'post123').map((c) => c.id)).toEqual([
      'c',
    ]);
  });

  it('reparents comments whose parent was dropped or cut by the cap', () => {
    const comments: RedditCommentData[] = [
      {
        id: 'parent',
        body: '',
        author: 'x',
        score: 99,
        parent_id: 'post123',
        created_utc: 100,
      },
      {
        id: 'child',
        body: 'C',
        author: 'x',
        score: 5,
        parent_id: 'parent',
        created_utc: 100,
      },
      {
        id: 'other',
        body: 'O',
        author: 'x',
        score: 50,
        parent_id: 'post123',
        created_utc: 100,
      },
    ];

    const result = finalizeComments(comments, 1, 'post123');

    expect(result).toEqual([
      {
        id: 'other',
        body: 'O',
        author: 'x',
        score: 50,
        parent_id: 'post123',
        created_utc: 100,
      },
    ]);

    const both = finalizeComments(comments, 10, 'post123');
    const child = both.find((c) => c.id === 'child');
    expect(child?.parent_id).toBe('post123');
  });

  it('keeps deleted comments because their body and author are non-empty', () => {
    const comments: RedditCommentData[] = [
      {
        id: 'd1',
        body: '[deleted]',
        author: '[deleted]',
        score: 0,
        parent_id: 'post123',
        created_utc: 100,
      },
    ];

    expect(finalizeComments(comments, 10, 'post123')).toEqual(comments);
  });

  it('keeps removed comments because their body is non-empty', () => {
    const comments: RedditCommentData[] = [
      {
        id: 'r1',
        body: '[removed]',
        author: '[deleted]',
        score: 0,
        parent_id: 'post123',
        created_utc: 100,
      },
    ];

    expect(finalizeComments(comments, 10, 'post123')).toEqual(comments);
  });

  it('reparents a kept child when the cap cuts its parent', () => {
    const comments: RedditCommentData[] = [
      {
        id: 'parent',
        body: 'P',
        author: 'x',
        score: 1,
        parent_id: 'post123',
        created_utc: 100,
      },
      {
        id: 'child',
        body: 'C',
        author: 'x',
        score: 50,
        parent_id: 'parent',
        created_utc: 100,
      },
    ];

    expect(finalizeComments(comments, 1, 'post123')).toEqual([
      {
        id: 'child',
        body: 'C',
        author: 'x',
        score: 50,
        parent_id: 'post123',
        created_utc: 100,
      },
    ]);
  });

  it('returns exactly the cap when more valid comments exist', () => {
    const comments: RedditCommentData[] = Array.from(
      { length: 60 },
      (_, i) => ({
        id: `c${i}`,
        body: `body ${i}`,
        author: 'x',
        score: i,
        parent_id: 'post123',
        created_utc: 100 + i,
      }),
    );

    expect(finalizeComments(comments, 50, 'post123')).toHaveLength(50);
  });
});

describe('rendered thread extraction', () => {
  const html = `
    <div id="comment-tree">
      <shreddit-comment thingid="t1_a1" author="alice" score="42" created="2026-11-13T10:00:00.000000+0000" depth="0">
        <div slot="comment">
          <p>First paragraph — héllo.</p>
          <p>Second with a <a href="https://example.com">link</a> and <code>code()</code>.</p>
          <p>emoji 🚀</p>
        </div>
        <div id="comment-children">
          <shreddit-comment thingid="t1_b1" author="bob" score="7" created="2026-11-13T10:01:00.000000+0000" depth="1">
            <div slot="comment"><p>Reply one.</p></div>
            <div id="comment-children">
              <shreddit-comment thingid="t1_c1" author="[deleted]" score="1" created="2026-11-13T10:02:00.000000+0000" depth="2">
                <div slot="comment"><p>[deleted]</p></div>
              </shreddit-comment>
            </div>
          </shreddit-comment>
        </div>
      </shreddit-comment>
      <shreddit-comment thingid="t1_d1" author="[deleted]" score="0" created="2026-11-13T10:03:00.000000+0000" depth="0">
        <div slot="comment"><p>[removed]</p></div>
      </shreddit-comment>
    </div>`;

  const extracted = parseCommentTree(html).map((raw) =>
    toRedditComment(raw, 'post1'),
  );

  it('keeps the exact words, including paragraphs, links, code and non-English', () => {
    expect(extracted[0]).toEqual({
      id: 'a1',
      body: 'First paragraph — héllo. Second with a link and code(). emoji 🚀',
      author: 'alice',
      score: 42,
      parent_id: 'post1',
      created_utc: 1794564000,
    });
  });

  it('keeps the hierarchy from DOM nesting, including deleted and removed replies', () => {
    expect(extracted.map(({ id, parent_id }) => [id, parent_id])).toEqual([
      ['a1', 'post1'],
      ['b1', 'a1'],
      ['c1', 'b1'],
      ['d1', 'post1'],
    ]);
  });

  it('keeps scores, authors and timestamps for every comment', () => {
    expect(
      extracted.map(({ id, author, score, created_utc }) => [
        id,
        author,
        score,
        created_utc,
      ]),
    ).toEqual([
      ['a1', 'alice', 42, 1794564000],
      ['b1', 'bob', 7, 1794564060],
      ['c1', '[deleted]', 1, 1794564120],
      ['d1', '[deleted]', 0, 1794564180],
    ]);
  });

  it('produces a well-formed tree for a long thread', () => {
    const depth = 30;
    const chain =
      Array.from(
        { length: depth },
        (_, i) =>
          `<shreddit-comment thingid="t1_n${i}" author="a${i}" score="${depth - i}" created="2026-11-13T10:00:00.000000+0000" depth="${i}"><div slot="comment">body ${i}</div>${'<div id="comment-children">'}`,
      ).join('') + '</div>'.repeat(depth);

    const comments = parseCommentTree(chain).map((raw) =>
      toRedditComment(raw, 'post1'),
    );
    const ids = new Set(comments.map((comment) => comment.id));

    expect(comments).toHaveLength(depth);
    expect(ids.size).toBe(depth);
    for (const comment of comments) {
      expect(comment.body.length).toBeGreaterThan(0);
      expect(comment.parent_id === 'post1' || ids.has(comment.parent_id)).toBe(
        true,
      );
    }
    expect(comments.map((comment) => comment.parent_id)).toEqual([
      'post1',
      ...comments.slice(0, -1).map((comment) => comment.id),
    ]);
  });
});
