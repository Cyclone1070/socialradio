# Running more than one app instance

Audited 2026-10-01 by searching for in-memory state, timers, schedulers and boot hooks, then reading
the queue, playback and lease paths, and re-checked against the code on 2026-10-02. The verdict:
**several instances can run without corrupting anything, and the two places that did the same paid
work twice are fixed.** Nothing here blocks a second instance. What is left is one deployment rule
about the fetcher (item 6), not a code change.

## State that is already shared, and stays correct

- **The playhead.** `channel.playhead_started_at`, `current_segment_id`, `current_play_order` and
  `last_active_at` live on the channel row, so every instance computes from the same clock and the
  idle freeze is derived from stored timestamps rather than from anything held in memory.
- **Per-post consumption.** `channel_post_progress` is the record of what a channel has already
  aired. It is written after the work, which is exactly the hole in item 2 below.
- **Scrape concurrency.** The claim on `subreddit` (`scrape_claim_id`, `scrape_started_at`) is taken
  atomically in the database, renewed by a heartbeat, expires after a staleness window, and a run that
  loses it stops. Two instances cannot walk the same subreddit at once.
- **Queue order.** `segment` is unique on `(channel_id, play_order)`, and the insert retries on that
  collision by re-reading the latest order. Concurrent inserts end up sequential rather than lost.
- **No sticky sessions needed.** Auth is a stateless JWT, audio is plain HTTP from object storage, and
  there is no SSE or WebSocket anywhere.
- **The sidecars hold nothing.** The app reaches the speech service and object storage by URL alone, so
  any number of either is interchangeable. The fetcher is the exception, and it is item 6 below.
- **Migrations.** A separate compose service runs them, never the app on boot, so a rolling deploy
  cannot race.
- **Nothing else in memory.** No cron, no in-memory sessions, no throttle counters, no response or
  entity caches. A sweep for `setInterval`/`setTimeout`/`@Cron`/debounce finds one hit, the shared claim
  lease's heartbeat, whose authority is the database row.

## In-memory state that affects behaviour

| Where | What | Effect with N instances |
|---|---|---|
| `src/channel/queue.service.ts` | `inFlightBuffers`: a map of channel to its in-flight buffer batch | Spares this process a duplicate batch, and nothing more. **Fixed** by the claim below, which is what a second *instance* respects |

## Findings, in the order they were fixed

1. ~~**Buffer batches are deduped per process, not per station.**~~ **Done.** The channel row carries
   `buffer_claim_id` and `buffer_claimed_at`; a batch takes the claim with one conditional write before
   it reads anything, stands aside if another instance holds it, renews it every 30 seconds while it
   works, releases it at the end, and stops before the next paid step if a renewal shows the claim has
   moved on. A claim untouched for three beats is up for grabs, so a crashed instance frees its station;
   a ten minute cap stops a batch that is alive but wedged from renewing for ever, which is what stops
   one stuck station from starving itself. The lease itself is shared:
   `src/infrastructure/lease/claim-lease.ts` is now used by both the scraper and the queue, with the cap
   passed in per caller, because a scrape walk and a buffer batch are different lengths of work.
2. ~~**A topic cluster is never claimed before generation.**~~ **Done.** Picking a cluster and marking
   its posts are now one transaction that locks the station row (`claimNextTopicCluster`), and the
   generation happens outside it. The second worker waits for the first to commit, sees the posts
   already spoken for, and moves on.

   Worth being honest about its standing: this is defence in depth rather than a live bug. The station
   claim above already stops two instances buffering the same station, so what is left is the take-over
   case — an owner whose renewals fail for three beats while its generation calls still work, or one
   that goes quiet and then resumes. A lease can bound that overlap but cannot remove it; making the
   decision atomic does. Nothing here is about sharing work between stations: clusters are built from
   each station's own unplayed posts, and generated audio belongs to the station that paid for it.
3. ~~**The playhead is read-modify-write with no lock.**~~ **Not an issue — withdrawn.** The playhead
   is read inside `em.transactional` with `lockMode: LockMode.PESSIMISTIC_WRITE`
   (`playback.service.ts:77-82`), so two instances cannot lose each other's move. The original audit
   read the block that mutates the playhead but not the transaction wrapping it. Recorded here so it is
   not raised again.
4. ~~**The admin seed is check-then-insert on boot.**~~ **Done.** The insert now treats a unique
   violation as another instance having done the job, and still fails loudly on anything else.
5. ~~**`ensureInstantFiller` is count-guarded, not claimed.**~~ **Done.** Counting the station and
   topping it up are now one transaction that locks the station row, so the second worker counts the
   first one's rows and appends nothing. This one was live rather than defensive: the filler top-up is
   deliberately outside the buffer claim (it is what makes a brand-new station audible at once), so two
   instances really could both fill the same gap.
6. **Not the app, but adjacent: the reddit fetcher's pacer** (500-1000 ms per request, same subreddit
   serialised) is per process. Running more than one fetcher container breaks the pacing that keeps us
   welcome on reddit. **Parked 2026-10-02, and answered by deployment rather than by code**: the fetcher
   is one container by design, because it *is* the pacing point. If it ever has to scale, the unit of
   scale is a (browserless + fetcher) pair with its own egress IP — reddit's limits are per IP, so a
   second fetcher behind the same egress IP would only double the request rate the pacer exists to hold
   down.

## How these were verified

- **Unit tests, in the spec that owns the code.** The queue spec asserts that a batch takes and releases
  the claim, that a second caller stands aside, and that picking a cluster and marking its posts happen
  inside one transaction holding a write lock on the station; the user spec asserts the seed race is
  accepted while any other error still fails loudly.
- **The docker suite drives the pipeline end to end** (suite 05 playback, suite 07 talk generation), and
  it is what caught the lock placed in the shared reader.
- **The two-instance checks were run by hand against a real Postgres, and deliberately not kept as a
  script**: they were worth doing once, and a committed two-container harness would be a second way of
  saying what the unit tests and the docker suite already say. What they proved is in the next section.

## What the buffer claim does and does not protect

It serialises *batches per station*: while one instance is generating a station's next runway, another
instance asked for the same station stands aside rather than paying for the same script and speech
again. What it does not do is make the work idempotent — if a claim is taken over because its owner
went quiet, the new owner starts its own batch, and the old owner stops at its next checkpoint rather
than finishing. Stopping is best effort by design: a batch wedged inside a single call that never
returns cannot be interrupted by the cap, only abandoned, which is why timeouts on the model and speech
calls are the real cure and the claim is the safety net.

## Verified against a real database, not only mocks

Run 2026-10-01 against a local Postgres with two app processes sharing it, by hand rather than through
a committed harness.

- **Two instances topping up a fresh station at the same time**: the station ends with six segments,
  not twelve. Before this batch both instances counted zero filler and both appended six.
- **Two instances buffering the same station**: exactly one entered the batch, a third asked while the
  claim was held also stood aside, and the claim row was held while the winner worked.
- The cluster claim's overlap needs a lease take-over to reproduce, so it is covered two ways instead:
  the unit test asserts the pick and the marking happen inside a transaction holding a write lock on
  the station, and the docker suite drives the whole path end to end (suites 05 and 07).
- Caught by the docker tier rather than the unit gate: a lock placed in the shared reader broke the
  admin topics endpoint with `An open transaction is required for this operation`. The lock belongs in
  the claim that wraps the reader, where a transaction exists.

## Deadlines we chose, rather than ones we inherited

- **The fetcher call has one now.** Measured against real reddit: 14 calls over two passes, 4.4-9.4
  seconds each, median about 6.5, and that already includes the pacer's deliberate 0.5-1s delay. Node's
  http client would only give up after five minutes of *silence*, and any byte resets that clock, so a
  hung browser job could hold the scrape claim - and every other instance standing aside - for the
  length of the walk. `REDDIT_FETCHER_TIMEOUT_MS` now defaults to 60s per call, about six times the
  worst observed call; the walk keeps its own 30-minute cap, and the scraper keeps releasing the claim
  in its `finally`.
- **The model call already had one**: 30s to the first chunk, 15s between chunks, 5 minutes total. No
  change needed, and the audit was wrong to imply otherwise.
- **The speech client deliberately has none yet.** It is a stub until real TTS lands, and the same
  one-line treatment applies then. Recorded so it is not re-raised as an oversight.
- **Not done, and why**: cancelling an in-flight call the moment the claim is lost. The cap stops
  renewals and the next checkpoint stops the next paid step, so what remains is one call in flight that
  would be aborted early. Worth doing when real speech arrives and those calls get long.
- **Known edge, not fixed**: `exists()` swallows any fetch failure as "no", so an existence check that
  hangs now answers "no" at the deadline rather than after five minutes of silence. The shape is the
  same as before the deadline - every network failure already read that way - but the caller acts on a
  false answer, so it is worth revisiting when that path matters.
