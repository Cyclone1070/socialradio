import { Post } from '../../feed/entities/post.entity';
import { Topic } from '../interfaces/topic.interface';

const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'in',
  'on',
  'at',
  'to',
  'for',
  'with',
  'by',
  'about',
  'of',
  'from',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'that',
  'this',
  'these',
  'those',
  'it',
  'its',
  'they',
  'them',
  'their',
  'our',
  'your',
  'my',
  'me',
  'i',
  'you',
  'he',
  'him',
  'his',
  'she',
  'her',
  'we',
  'us',
  'why',
  'what',
  'how',
  'when',
  'where',
  'who',
  'which',
]);

export function tokenize(title: string): Set<string> {
  const clean = title
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/);
  return new Set(clean.filter((w) => w.length > 1 && !STOP_WORDS.has(w)));
}

export function jaccardSimilarity(
  setA: Set<string>,
  setB: Set<string>,
): number {
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersectionSize = 0;
  for (const item of setA) {
    if (setB.has(item)) {
      intersectionSize++;
    }
  }
  const unionSize = setA.size + setB.size - intersectionSize;
  return intersectionSize / unionSize;
}

export function clusterPosts(posts: Post[], threshold = 0.35): Topic[] {
  const segments: Topic[] = [];
  const sortedPosts = [...posts].sort((a, b) => b.score - a.score);
  const mapped = new Set<string>();

  for (const post of sortedPosts) {
    if (mapped.has(post.id)) continue;

    const cluster: Post[] = [post];
    mapped.add(post.id);

    const postTokens = tokenize(post.title);

    for (const otherPost of sortedPosts) {
      if (mapped.has(otherPost.id)) continue;

      const otherTokens = tokenize(otherPost.title);
      const sim = jaccardSimilarity(postTokens, otherTokens);

      if (sim >= threshold) {
        cluster.push(otherPost);
        mapped.add(otherPost.id);
      }
    }

    segments.push({
      id: post.id,
      posts: cluster,
    });
  }

  return segments;
}
