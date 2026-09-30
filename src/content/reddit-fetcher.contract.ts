import { z } from 'zod';

/**
 * What this backend requires from the reddit fetcher.
 *
 * The backend does not import the fetcher's types: it declares its own
 * requirement and checks what actually arrives, because the fetcher is a
 * separately deployed service and its compiler knows nothing about the one
 * running in front of it.
 *
 * The objects are loose on purpose — a fetcher may add fields without breaking
 * us, but a missing or renamed one is a contract break and fails loudly here
 * instead of turning into `undefined` deep inside the scraper.
 */
export const redditPostSchema = z.looseObject({
  id: z.string(),
  title: z.string(),
  selftext: z.string().optional(),
  author: z.string(),
  score: z.number(),
  created_utc: z.number(),
});

export const redditCommentSchema = z.looseObject({
  id: z.string(),
  body: z.string(),
  author: z.string(),
  score: z.number(),
  parent_id: z.string(),
  created_utc: z.number(),
});

export const topPostsResponseSchema = z.looseObject({
  posts: z.array(redditPostSchema),
  after: z.string().nullable(),
  isInvalid: z.boolean(),
});

export const commentsResponseSchema = z.looseObject({
  comments: z.array(redditCommentSchema),
});

export const existsResponseSchema = z.looseObject({
  valid: z.boolean(),
});

/**
 * Raised when the fetcher answers with something the contract does not allow.
 *
 * This is deliberately distinct from the fetcher's own "this subreddit is gone"
 * signal: an invalid subreddit deletes its row, while a broken payload must only
 * fail the scrape. Confusing the two would turn a deployment mistake into data
 * loss.
 */
export class RedditFetcherContractError extends Error {
  constructor(
    readonly route: string,
    readonly problem: string,
  ) {
    super(
      `Reddit fetcher returned an unexpected payload for ${route}: ${problem}`,
    );
    this.name = 'RedditFetcherContractError';
  }
}

export const parseFetcherPayload = <S extends z.ZodType>(
  schema: S,
  payload: unknown,
  route: string,
): z.infer<S> => {
  const result = schema.safeParse(payload);
  if (!result.success) {
    const problem = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new RedditFetcherContractError(route, problem);
  }
  return result.data;
};
