/**
 * What the station says when it steps out of the conversation. These serve the
 * breaks and the filler alike: a pool of one hundred, so a
 * listener who hears two breaks in ten minutes does not hear the same sentence.
 */
export const BREAK_LINERS: readonly string[] = [
  "We'll be right back after this.",
  "Stay with us, we're not going anywhere.",
  "Quick breather, then we're back on the line.",
  "Hold that thought, we'll be back in a moment.",
  "We're lining up the next caller right now.",
  "Don't touch that dial, we're coming right back.",
  'Just a minute while we sort out the phone lines.',
  'Back in a flash with more of your calls.',
  "We're catching our breath, back shortly.",
  'One moment, the switchboard is lighting up.',
  "We'll be back before you can make a cup of tea.",
  'Short break, then straight back into it.',
  'Stay tuned, the next story is a good one.',
  "We're patching someone through right now.",
  "Give us a second, we've got calls waiting.",
  'Back after the break with the verdict.',
  "We're not done with this one yet, back soon.",
  "Hold tight, we'll be with you in a moment.",
  "Someone's on the line, we'll be right back.",
  "We're queuing up the next caller as we speak.",
  'A brief pause, then more voices from the internet.',
  "We'll return to the phones in just a moment.",
  "Don't go anywhere, the best call is still coming.",
  "We're resetting the studio, back in a minute.",
  "One quick pause and we're back.",
  "Stay close, we've got more to get through.",
  "We're bringing the next caller in shortly.",
  "Let's take a short break, we'll be right back.",
  "We're still here, just catching up on the lines.",
  'Be right back with the other side of this story.',
  "Hold the line, we'll be right with you.",
  'A moment of calm, then back to the chaos.',
  "We're getting the next guest ready for you.",
  'Short pause, long show, back in a moment.',
  "We'll be back with more from the thread.",
  "Don't wander off, we're back in seconds.",
  "We're taking a quick pause for the switchboard.",
  'Give us a moment to line up the next call.',
  'Back shortly with the strangest one yet.',
  "We're not finished, just pausing for breath.",
  'Stay with us, this is where it gets good.',
  "We'll be right back after a word from nobody.",
  'Quick reset, then the phones open again.',
  "We're coming back to this in a moment.",
  "Hold that call, we'll be back for it.",
  'A short break, then more of your dilemmas.',
  "We'll be back with the comments that got buried.",
  "We're sorting the queue, back in a moment.",
  "Don't hang up on us, we're back shortly.",
  "We'll return with another internet disaster.",
  'Short intermission, the hosts are arguing.',
  "We're back in a moment with a fresh caller.",
  'Stay right there, the next line is open.',
  "We're just letting the kettle boil, back soon.",
  "Give us thirty seconds and we're back.",
  "We'll be with you again before long.",
  "We're lining up the wildest comment for you.",
  "Hold on, we've got a caller from the other side.",
  'A brief pause, then the verdict.',
  "We're still taking calls, back in a moment.",
  "Don't touch anything, we're mid-sentence.",
  "We'll be back with the follow-up you asked for.",
  'Quick break, then straight to the phones.',
  "We're grabbing the next one from the thread.",
  'One moment, the crowd has opinions.',
  "We're back in a heartbeat with more calls.",
  "Stay put, we're reeling in the next caller.",
  "We'll be right back, right after this.",
  "The lines are open, we're just regrouping.",
  'Short pause, no filler, well, apart from this.',
  "We're back with the update in a moment.",
  'Hold tight, the hosts need a timeout.',
  "We'll be back before the song ends.",
  "We're pulling the next story from the pile.",
  "Give us a moment, we're choosing the best one.",
  "We'll return with a caller who disagrees.",
  'Stay with us, the phones are still open.',
  "We're back after a moment of dead air avoidance.",
  "Don't stray, we're about to take another call.",
  "We're queuing the next argument right now.",
  "Hold on, we're settling a dispute in the studio.",
  "We'll be back with the rest of the story.",
  'A short break while we count the calls.',
  "We're not vanishing, just stepping out briefly.",
  "Stay on the line, we're almost there.",
  "We'll be back with someone who called in hot.",
  "We're reloading the switchboard, back soon.",
  'One moment while the producers shout at us.',
  "We'll return to the phones after this.",
  "Don't go far, the next call is unhinged.",
  "We're back in a moment with the full verdict.",
  "Hold steady, we're getting the caller on air.",
  "We'll be right back, the studio is chaos.",
  'Short break, then the story everyone missed.',
  "We're lining up the last word on this one.",
  "Stay close, we're about to open the lines.",
  "We'll be back with the fallout from this one.",
  "Hold on, we're getting a caller who was there.",
  'One quick break, then the phones open again.',
  "We're back in a second with the missing detail.",
];

/**
 * The lines to store: the first ones that are not already there, in pool order.
 * Comparison ignores case and surrounding spaces, because the pool is written by
 * hand and the database only remembers exactly what it was given.
 */
export function planLinerSeed(
  existingTexts: readonly string[],
  count: number,
): string[] {
  if (count <= 0) return [];
  const normalise = (text: string) => text.trim().toLowerCase();
  const stored = new Set(existingTexts.map(normalise));
  const plan: string[] = [];
  for (const line of BREAK_LINERS) {
    if (plan.length >= count) break;
    const key = normalise(line);
    if (stored.has(key)) continue;
    stored.add(key);
    plan.push(line);
  }
  return plan;
}
