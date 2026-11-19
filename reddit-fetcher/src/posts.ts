import { JSDOM } from 'jsdom';
import type { RedditPostData } from './types';

/**
 * Parses the rendered subreddit feed. Post data lives in `shreddit-post`
 * attributes, so no `.json` endpoint is involved.
 */
export function parseTopPosts(html: string): RedditPostData[] {
  const document = new JSDOM(html).window.document;

  return [...document.querySelectorAll('shreddit-post')]
    .map((element) => {
      const created = element.getAttribute('created-timestamp') || '';
      const body = element.querySelector('[slot="text-body"]');
      const paragraphs = body
        ? [...body.querySelectorAll('p, li')]
            .map((node) => (node.textContent ?? '').trim())
            .filter(Boolean)
        : [];
      const selftext =
        paragraphs.length > 0
          ? paragraphs.join(' ')
          : (body?.textContent ?? '').replace(/\s+/g, ' ').trim();
      return {
        id: (element.getAttribute('id') || '').replace(/^t3_/, ''),
        title: element.getAttribute('post-title') || '',
        selftext,
        author: element.getAttribute('author') || '',
        score: Number(element.getAttribute('score')) || 0,
        created_utc: Math.floor(Date.parse(created) / 1000) || 0,
      };
    })
    .filter((post) => post.id.length > 0 && post.title.length > 0);
}
