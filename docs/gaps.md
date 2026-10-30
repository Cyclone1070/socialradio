# Known gaps

What SocialRadio needs and does not have yet. Last read against the code: 2026-10-30.

This is the one place a "not built yet" belongs. [plan.md](../plan.md) is the working log of what was
fixed and why, [scaling.md](scaling.md) is the multi-instance audit, [script-structure.md](script-structure.md)
describes the show format, and [archive/](archive/) holds finished plans. When something below lands,
delete its entry here and let the commit message carry the story.

Every entry says what it **blocks**, because that decides the order. Three of these are a controller and
a test; the rest are decisions, not code.

---

## 1. Built, but not wired

Small and self-contained, and each one blocks real use.

### 1.1 No sign-up route

`UserService.create(dto, passwordHash)` exists and is unit-tested; no controller exposes it. The only
account that can exist is the admin seeded at boot from `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

- **Blocks**: multi-tenancy. Channels belong to a user — `GET /channels` returns yours plus the public
  ones — so with a single account that ownership model is never exercised.
- **Done means**: `POST /auth/register` behind the same validation as login, with the duplicate-email
  409 and the weak-password 400 pinned by tests.

### 1.2 No media library write path

`src/media/` has a service and three tables (`music_track`, `break_liner`, `jingle`), and no controller.
Library contents are operator-managed by hand.

Seeding the *rows* now exists: `media-tools` reads a manifest (`media-tools/library/manifest.json`)
describing every audio file the station owns, and makes the rows agree with it - adding what is
missing, correcting what disagrees, and refusing to write a row for an object the bucket does not
hold. Running it twice writes nothing the second time. The draw path is defended from the other side
too: a row whose audio has gone from the bucket is left out of the pool (checked once per process), so
a stale row degrades into "that part of the break is dropped" instead of a 404 mid-break.

What is still missing is content rather than machinery. The commands exist and are tested - `speak`
speaks the pool and writes the row in the same run, `add` records a file, `publish` and `promote` move a
manifest between buckets, `seed` reconciles the rows (and, with `--prune`, the bucket), `remove` retires a
clip - but nobody has run them with real audio behind them.

- **Break liner clips.** `media-tools speak` will speak the hundred lines in `media-tools/library/break-liner-lines.json`,
  but nobody has run it against a real speech service, so the inventory starts empty.
- **Songs and jingles.** `media-tools add` measures a file and records it, but the files themselves are not
  in the repository and no source is chosen for them.
- **Orphan cleanup is new and unexercised.** `seed` now deletes rows the manifest no longer lists, and
  `seed --prune` sweeps library audio under `music/`, `jingle/` and `break_liners/` that no entry claims.
  Both only have unit tests; neither has run against a real bucket with real deletions.

- **Blocks**: a station that sounds like a station. With an empty library the queue still fills - the
  break drops whatever it cannot draw (`queue.service.ts`, "a break pool is empty, leaving that part of
  the break out") - but every break and every filler comes out shorter than it should be. Nothing
  falls back to a placeholder key: the fixture's `jingles/station-id.mp3` is a test row, not a default.
- **Done means**: the pool spoken against a real engine, songs and jingles chosen and recorded, and
  reconcile-plus-prune run once against a real library that had something deleted from it. Uploading audio through the API is a separate decision: the app
  only ever writes what it generated itself, so a user-supplied file would be the first untrusted
  object in the bucket.

### 1.3 No CORS

`src/main.ts` never calls `enableCors`.

- **Blocks**: any browser player on another origin. Same-origin only works behind a proxy that is not
  in this repository.
- **Done means**: an origin allowlist read from configuration — not `*`, since audio URLs are public
  but the API is not.

### 1.4 The conversation hands off to something it cannot know

The dialogue prompt tells the hosts to share "a quick final reaction/joke before transitioning
naturally to what's next" (`script.service.ts`). What's next is a break liner and a song, chosen after
the conversation was written, and the next conversation is a different thread. So the model invents a
hand-off - "let's get another one in" - and the station then plays music.

- **Blocks**: a clean seam. With the conversation doing its own hand-off and the break liner doing
  another, every break announces itself twice, and the first one is a guess.
- **Done means**: the conversation ends on its own story, and the prompt says so. The station handles
  the break; nothing in the script may refer to what follows.

### 1.5 The break liner has no music under it

Segments are separate files listed in the manifest; nothing mixes, fades or crossfades. So the break
liner starts on the last syllable of the goodbye, in a voice the listener has not heard, with no sting
underneath. The words can be perfect and the cut still sounds pasted.

- **Blocks**: the break sounding like a station rather than a playlist with interruptions.
- **Done means**: a bed or sting under each break liner, mixed in when the clip is spoken (`media-tools`
  already shells out to ffmpeg to measure what it produced, so the tooling is there), so playback needs
  no new step - and a listener hears no cold cut between a conversation and the announcement.

---

## 2. Never built

### 2.1 A listener client

Nothing in this repository plays the stream. The only consumer of `GET /channels/:id/live.m3u8` is
ffmpeg inside the docker suite.

- **Blocks**: knowing that a real player accepts what we serve — manifest headers, chunk URLs and the
  storage public URL have only ever been checked by a test client.
- **Done means**: a browser or phone playing a public station end to end, from a host that is not
  localhost. This is probably a separate artifact, not a slice of this backend.

### 2.2 Content safety

No NSFW, profanity or topic filter exists anywhere between a scraped Reddit thread and a synthesized
broadcast voice. The scrape guards on comment count and word count, and nothing else.

- **Blocks**: running a station whose output you are willing to publish. The model is asked to be
  natural, not to be careful.
- **Done means**: a decision first — filter at ingest, filter at generation, or accept the source — and
  then the code that enforces it.

### 2.3 Analytics and observability

No listener counts, no play history, no per-station health. Logging is structured JSON and nothing
aggregates it.

- **Blocks**: operating the thing. There is currently no way to answer "is anyone listening", "what
  aired last night", or "has generation been failing for an hour" without reading logs by hand.
- **Done means**: at minimum the one [plan.md](../plan.md) already defers to prod — a health signal when
  generation fails repeatedly. It is cheap, and it is what would make 3.3 visible instead of silent.

### 2.4 Advertising as a business

There is no advertising anywhere in the system: the advert type, its table and its picker were removed
when the media phase was rewritten, and the station now says "we'll be right back" in its own voice over
music it owns (`src/media/media.service.ts`).

- **Blocks**: selling anything. No campaigns, no targeting, no scheduling, no reporting, no proof a slot
  ever aired, and no place to put one.
- **Done means**: this is product scope rather than a defect — it needs a decision about whether ads are
  a feature at all before it needs code, and the seam it would return through is the break liner segment.

### 2.5 Production shape

Deployment is one development compose file. The CDN design — 2-second manifest caching, request
collapsing, a 0.5 req/s origin cap per station — exists as prose in
[archive/hls-migration-plan-2026-09.md](archive/hls-migration-plan-2026-09.md#23-unified-edge-reverse-proxy--ingress-routing)
and as configuration nowhere.

- **Blocks**: the economics the architecture was chosen for. Without edge caching, every listener is an
  origin request.
- **Done means**: an edge config checked in (or documented as a manual step), a production compose or
  manifest, and a backup and retention plan for the database and the media bucket. Today there is a
  named volume and nothing else.

### 2.6 No infrastructure as code

There is no Terraform in this repository, and the application creates its own infrastructure at boot:
`storage.service.ts` issues `CreateBucketCommand` and then a public-read bucket policy. The two buckets
the media phase needs - one to publish into, one to promote into - exist only in the test compose and
in prose.

- **Blocks**: provisioning a real environment, and the credential split that goes with it. An app that
  creates buckets needs credentials that can create buckets, which is the credential a running station
  should never hold.
- **Done means**: infrastructure declared outside this repository - both buckets, their policies, and a
  runtime credential that can read and write objects but not create or re-policy anything - and the boot
  path reduced to a health check that fails loudly when the bucket it expects is not there.

### 2.7 No deploy pipeline and no rollback

`ci.yml` runs the gate and the docker suites. Nothing promotes a build: no migrate, no manifest
promote, no seed, no boot. The environment variables those steps need - bucket names, endpoints,
credentials - are not written down anywhere.

- **Blocks**: shipping. The whole media path has only ever run inside the test stack, where the compose
  file supplies every value.
- **Done means**: a workflow that migrates, promotes the library, seeds it and starts the app against a
  real environment, an env-var contract in `library/README.md`, and a rollback that is written down and
  has been tried once - the station is append-only, so pointing at an older manifest and re-running is
  the whole rollback, but nobody has done it.

---

## 3. External dependencies that decide whether it can run for real

These are not our code, and each one has lead time, so they are the entries worth starting early.

### 3.1 The speech engine

`voice-service` synthesizes with `msedge-tts` — Microsoft's consumer Edge endpoint.

- **Blocks**: any commercial use. It is unofficial, carries no licence and no SLA, and can change or
  disappear without notice. The seam is right (swapping engines replaces one container), but the engine
  behind it is a placeholder.
- **Done means**: a licensed engine or a self-hosted model behind the same `POST /synthesize` contract,
  with the duration still measured from the audio rather than assumed.

### 3.2 Reddit access

Scraping is anonymous, through browserless, from whatever IP the host has. There are no Reddit
credentials anywhere in this repository.

- **Blocks**: reliability. Datacenter IPs are widely blocked and rate-limited; the Tier 2 probe passes
  from a developer machine and reports SKIP when reddit is unreachable, which is the honest status.
  There is also no proxy or egress plan.
- **Done means**: a deliberate choice between a Reddit API application and proxies per fetcher pair,
  plus the pacer's rule (one fetcher per egress IP) written into the deployment.

### 3.3 The language model

Script generation runs on a free OpenRouter model.

- **Blocks**: predictable cost and availability. The shared free pool returns 429s, which the contract
  probe classifies as provider-unavailable rather than a broken contract.
- **Done means**: a paid first-party provider, which is also when the deferred second-provider fallback
  starts to be worth building.

---

## Deliberately not on this list

Things that look missing and are decisions, recorded here so they stop being re-raised:

- **The eight black-box suites stay black box**, and are not ported into the in-process spec style.
- **The paid tier runs on pull requests only** — no nightly, no pre-release schedule. Integration tests
  do not detect provider drift.
- **One fetcher container**, because it *is* the pacing point; scaling means another pair with its own
  egress IP ([scaling.md](scaling.md)).
- **No `LLM_MODEL` startup check.** It detects at deploy time and does nothing about a model retired
  while the app runs.
- **No invented fallback script** when generation fails: the queue plays filler instead.
- **Per-slice READMEs stay deleted.** Behaviour duplicated in prose drifts; the code and `docs/` are
  where it belongs.

---

## The next step

Put a real listener on a real station: the section 1 items, an edge config from section 2.5, and a
browser or phone pointed at a public channel. It is the only check that exercises the product the way
a listener does, and it forces the two decisions with real lead time — Reddit access (3.2) and a
licensed voice (3.1). Those two can be started in parallel, because neither is code in this repository.
