/**
 * The fetcher's payloads, built as typed objects — the same way the fetcher
 * builds them (see reddit-fetcher/src/scraper.ts).
 *
 * The types are imported rather than re-declared, so this file cannot describe a
 * shape the fetcher does not produce: rename a field there and this stops
 * compiling. The import is type-only, so it is erased at runtime and the mock's
 * container needs nothing from the fetcher package.
 */
import type {
  RedditCommentData,
  RedditPostData,
} from '../../reddit-fetcher/src/types';

export interface TopPostsPage {
  posts: RedditPostData[];
  after: string | null;
  isInvalid: boolean;
}

const ago = (now: number, hours = 1): number => now - hours * 3600;

export const topPosts = (now: number): TopPostsPage => ({
  posts: [
    {
      id: 'mockpost1',
      title: 'My landlord kept the deposit after I moved out',
      selftext:
        'I moved out three months ago, left the flat spotless, and the landlord stopped replying. There was never a signed inventory.',
      author: 'throwaway_tenant',
      score: 812,
      created_utc: ago(now),
    },
    {
      id: 'mockpost2',
      title: 'Letting agent says the deposit was never protected',
      selftext:
        'The agent admits the deposit was not put in a protection scheme. I have the original bank transfer as proof.',
      author: 'deposit_gone',
      score: 640,
      created_utc: ago(now),
    },
    {
      id: 'mockpost3',
      title: 'Can I claim for the weeks the deposit was held',
      selftext:
        'Beyond the deposit itself, the scheme rules mention a penalty when it was never protected. Has anyone actually claimed it?',
      author: 'small_claims_uk',
      score: 511,
      created_utc: ago(now),
    },
    {
      id: 'mockpost4',
      title: 'Landlord wants to deduct for wear and tear',
      selftext:
        'They are claiming repainting costs after six years of tenancy. That sounds like wear and tear rather than damage.',
      author: 'six_years_in',
      score: 388,
      created_utc: ago(now),
    },
    {
      id: 'mockpost5',
      title: 'Wrote my own demand letter and it worked',
      selftext:
        'Template letter, fourteen days to pay, and a copy of the check-in photos. Money arrived on day ten.',
      author: 'diydemand',
      score: 1204,
      created_utc: ago(now),
    },
    {
      id: 'mockpost6',
      title: 'How long does small claims take for a deposit',
      selftext:
        'Filed online, hearing was listed six weeks later, and the landlord settled the day before. Cost me a small fee.',
      author: 'county_court_pro',
      score: 275,
      created_utc: ago(now),
    },
  ],
  after: null,
  isInvalid: false,
});

/** A subreddit that no longer exists: the app deletes its row on this signal. */
export const invalidPage = (): TopPostsPage => ({
  posts: [],
  after: null,
  isInvalid: true,
});

const SENTENCES: readonly string[] = [
  'The check-in report is the document that decides almost every deposit dispute, because it is the only written record of the state of the flat on the day you moved in.',
  'No signed inventory means the landlord has nothing to point at when they claim the walls needed repainting, and adjudicators know that.',
  'Send a written demand first, give a clear deadline of fourteen days, and keep a copy of everything you send.',
  "Photographs with timestamps carry far more weight than anyone's memory of how clean the place was, so dig out every picture from the day you left.",
  'If your deposit was never protected in a government-backed scheme, you may be able to claim a penalty on top of the deposit itself, and the rules differ depending on where you live.',
  'Small claims is designed for exactly this kind of dispute, it is inexpensive, and you do not need a solicitor for an amount this size.',
  'Whether a deduction counts as damage or as fair wear and tear usually turns on how long you lived there and what the original condition was.',
  'Keep the conversation in writing from now on, because a phone call leaves you with nothing to show an adjudicator later.',
  'Ask the agent for the scheme certificate and the prescribed information, since they are obliged to give you both within thirty days of receiving the money.',
  'A demand letter that quotes the relevant legislation tends to get a faster response than one that simply complains.',
  'If the landlord stops replying, that is not a defence, and a court can proceed without them once they have been served properly.',
  'Get a free opinion from a housing advice service before you file, because they will spot the weakness in your case before the other side does.',
  'Bank statements showing the transfer are useful, but they are not a substitute for the scheme paperwork that should have followed it.',
  'Adjudicators generally expect the landlord to prove the loss with invoices and a condition report, rather than with an estimate they wrote themselves.',
  'Interest and the filing fee can sometimes be added to the claim, so it is worth calculating the total before you decide on the amount.',
  'Do not accept a partial refund as a final settlement unless you are genuinely happy with it, because accepting the money can end the dispute.',
  'The tenancy agreement often says the deposit is held by the agent, but the legal duty to protect it sits with the landlord either way.',
  'If the deadline passes with no payment, the next step is a letter before action and then the online claim, which takes about twenty minutes to complete.',
  'Keep a simple timeline of dates, because hearings move quickly and a single sheet is far easier to follow than a folder of messages.',
  'Most of these cases settle before the hearing once the other side sees that you have the documents and you are prepared to turn up.',
];

/**
 * A long thread: the app only keeps a post whose comments total 2500 words, so a
 * short canned thread would look like an unusable post and save nothing.
 * Ids carry the post id because reddit ids are unique site-wide and the app
 * enforces that with a unique constraint.
 */
export const comments = (postId: string, now: number): RedditCommentData[] =>
  Array.from({ length: 14 }, (_, index) => ({
    id: `${postId}_c${index + 1}`,
    body: Array.from(
      { length: 8 },
      (_, offset) => SENTENCES[(index + offset) % SENTENCES.length],
    ).join(' '),
    author: `commenter_${index + 1}`,
    score: 120 + index * 37,
    parent_id: `t3_${postId}`,
    created_utc: ago(now),
  }));
