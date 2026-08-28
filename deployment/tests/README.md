# E2E Test Suite — Automated Manual QA Gate

> **CRITICAL RULE FOR ALL AGENTS AND DEVELOPERS**:
> The sole purpose of this E2E suite is to **automate manual QA testing**. Every test case in this suite represents an engineer manually spinning up the entire Docker stack and curling endpoints in their terminal to inspect real, live behavior.
> 
> **Zero Tolerance for False Passes**: There must NEVER be a scenario where a bug exists during manual verification but the E2E test passes. A passing test that hides a manual QA failure is a critical protocol violation. E2E is the **final, non-negotiable QA gate** before release.

---

## Architecture & Mechanics

- **Clean State Isolation**: The suite runs from a clean state. Containers and volumes are torn down after every run (`run-docker-test.sh`).
- **Network & Host Isolation**: The test container curls the app via `http://app:3000` on an isolated Docker network.
- **SQL Pattern**: One access point — the `psql_run` helper in `docker-test.sh` runs database fixtures located in `deployment/tests/fixtures/` (`seed-base.sql`, `dead-sub.sql`, `ai-talk.sql` with `-v` psql variables). No other SQL paths exist.
- **Read-Back Assertions**: Every mutation is verified by read-back: subscribe/unsubscribe are followed by `GET /channels/:id/subreddits` to prove the link changed in the database. Responses are parsed with `jq` to verify exact structure, casing, and values.
- **Auth Guard Verification**: Every protected endpoint asserts its own auth negatives (missing token, malformed token, insufficient permissions) — any route missing its guard decorator immediately fails the suite.

---

## Running the Suite

### Full Suite (Runs all 7 sections sequentially)
```sh
./deployment/tests/run-docker-test.sh
```

### Isolated Section Execution (Runs dependencies once, then target suite)
```sh
# Run Section 1: Healthcheck
./deployment/tests/run-docker-test.sh 01

# Run Section 2: Auth & Identity
./deployment/tests/run-docker-test.sh 02

# Run Section 3: Channels & Subreddits
./deployment/tests/run-docker-test.sh 03

# Run Section 4: Security & Route Guards
./deployment/tests/run-docker-test.sh 04

# Run Section 5: Playback, Idle & Queue Safety
./deployment/tests/run-docker-test.sh 05

# Run Section 6: Real Reddit Scraping & Active Pool
./deployment/tests/run-docker-test.sh 06

# Run Section 7: Live AI Talk Generation & MinIO Blob Storage
./deployment/tests/run-docker-test.sh 07
```

---

## Scenario Inventory

### Section 1: Healthcheck (`suites/01-healthcheck.sh`)
*Stack liveness and ISO timestamp check.*

| # | Scenario | Expected |
|---|---|---|
| 1 | `GET /healthcheck` | 200, `status: "ok"`, valid ISO timestamp present |

### Section 2: Auth & Identity (`suites/02-auth.sh`)
*Login contract, token validity, profile isolation, and user enumeration safety.*

| # | Scenario | Expected |
|---|---|---|
| 2 | Admin login | 201 + accessToken |
| 3 | `GET /users/me` with admin token | email matches admin, id + createdAt present |
| 4 | Regular user login (fixture) | 201 + accessToken |
| 4b | `GET /users/me` with user token | email matches regular user, id present |
| 5 | Login empty body | 400 + validation messages |
| 6 | Login invalid email format | 400 + message mentions email |
| 7 | Login wrong password | 401 + "Invalid credentials" |
| 8 | Login non-existent email | 401 + "Invalid credentials" (same message — no user enumeration) |
| 9 | `GET /users/me` no token | 401 body confirms |
| 10 | `GET /users/me` malformed JWT | 401 body confirms |

### Section 3: Channels & Subreddits (`suites/03-channels.sh`)
*Channel lifecycle, subscription semantics (verified by read-back), and input validation.*

| # | Scenario | Expected |
|---|---|---|
| 11 | `POST /channels` create | 201, name matches, `visibility == "public"`, createdAt present |
| 12 | `GET /channels` list | contains the created channel |
| 13 | Subscribe `r/AskReddit` | 201, empty body, **read-back: AskReddit in list** |
| 14 | **Duplicate** subscribe `r/AskReddit` | 201, empty body, **read-back: exactly one AskReddit** |
| 15 | Unsubscribe `r/AskReddit` | 200, empty body, **read-back: AskReddit gone** |
| 16 | **Re-subscribe** `r/AskReddit` (proves link is fully recreatable) | 201, empty body, **read-back: AskReddit back** |
| 17 | `POST /channels` empty name | 400 + message mentions name |
| 18 | Subscribe to fake UUID channel | 404 + "Channel not found" |
| 19 | `POST /channels` no token | 401 body confirms |
| 20 | Subscribe no token / malformed token | 401 body confirms |
| 21 | Unsubscribe no token / malformed token | 401 body confirms |
| 22 | `GET /channels/:id/subreddits` no token / malformed token | 401 body confirms |
| 23 | **Subscribe invalid body** (non-string `subredditName`) | 400 + body confirms |
| 24 | **Unsubscribe a sub that was never subscribed** | 404 + "Subreddit not found" |
| 25 | `GET /channels/active` internal guard | 401 without/wrong token, 200 with valid secret |

### Section 4: Security & Route Guards (`suites/04-security.sh`)
*Admin-only routes assert their 401 (no token) and 403 (regular user token).*

| # | Scenario | Expected |
|---|---|---|
| 26 | `POST /admin/feeds/scrape` no token | 401 body confirms |
| 27 | `POST /admin/feeds/scrape` regular user token | 403 body confirms |
| 28 | `GET /admin/feeds/subreddits` no token | 401 body confirms |
| 29 | `GET /admin/feeds/subreddits` regular user token | 403 body confirms |
| 30 | `DELETE /admin/feeds/cache` no token | 401 body confirms |
| 31 | `DELETE /admin/feeds/cache` regular user token | 403 body confirms |
| 32 | `GET /admin/channels/:id/topics` no token | 401 body confirms |
| 33 | `GET /admin/channels/:id/topics` regular user token | 403 body confirms |

### Section 5: Playback, Idle & Queue Safety (`suites/05-playback.sh`)
*Playback FIFO progression, idle resource conservation, cold-start batch generation, tail-resume, and internal token security.*

| # | Scenario | Expected |
|---|---|---|
| 34 | Cold-start empty channel `GET /channels/:id/next-track` | 200 OK, returns Track #1, sets `currentSegmentId` |
| 35 | Read-back `channel.currentSegmentId` in DB | Matches returned segmentId |
| 36 | Tail-resume reconnect `GET /channels/:id/next-track?resuming=true` | 200 OK, returns current segment with `startOffsetSeconds >= 0` |
| 37 | Sequential `GET /channels/:id/next-track` | 200 OK, FIFO advancement |
| 38 | SQL read-back `play_order` | `play_order` strictly increments |
| 39 | `GET /channels/:id/next-track` no token / wrong secret | 401 body confirms |
| 39b | `GET /channels/:fakeUuid/next-track` | 404 + "Channel not found" |

### Section 6: Real Reddit Scraping & Active Pool (`suites/06-scraping.sh`)
*Topic clustering, proactive pool deficit triggering, lazy 20-sub suppression, and dead sub cascade deletion.*

| # | Scenario | Expected |
|---|---|---|
| 40 | SQL fixture: seed 19 active subs with posts | read-back: 20 subreddits subscribed |
| 41 | `GET /admin/channels/:id/topics` (active pool = 19 < 20) | 200, topic id present — **triggers AskReddit scrape** |
| 42 | Poll `GET /admin/feeds/subreddits` | AskReddit has `postCount > 0` (active pool reaches 20) |
| 43 | SQL fixture: inject dead sub behind API gate | read-back: 21 subreddits subscribed |
| 44 | `GET /admin/channels/:id/topics` (active pool = 20 >= 20) | 200, topic resolved, **0 scrapes triggered** (dead sub remains) |
| 45 | Mark 1 post complete (active drops to 19) + `GET .../topics` | triggers dead sub scrape $\rightarrow$ dead sub **auto-unsubscribed via cascade** |

### Section 7: Live AI Talk Generation & MinIO Blob Storage (`suites/07-ai-storage.sh`)
*Targeted AI synthesis pipeline (OpenCode Zen LLM + Microsoft Edge Neural TTS) and MinIO object storage verification.*

| # | Scenario | Expected |
|---|---|---|
| 46 | Seed targeted dilemma post on `r/ai_talk_fixture_sub_e2e` | DB contains 1 post + 3 structured comments |
| 47 | Create channel & subscribe `ai_talk_fixture_sub_e2e` | 201 Created & verified |
| 48 | Trigger `bufferAhead` (`GET /channels/:id/next-track`) | 200 OK, returns talk track, synthesizes live multi-turn script with OpenCode + Edge TTS |
| 49 | SQL verification: inspect TalkSegment in DB | `status == 'ready'`, duration $> 0$, multi-turn dialogue array |
| 50 | MinIO Blob Storage Verification | Queries MinIO S3 API -> confirms generated `.mp3` blob exists and size $> 10\text{ KB}$ |

### Section 8: Live Broadcast & Streaming (`suites/08-broadcast.sh`)
*Icecast server health, dynamic Liquidsoap channel mounts, HTTP live stream handshake, stream byte capture, audio energy verification, and listener telemetry.*

| # | Scenario | Expected |
|---|---|---|
| 51 | `GET http://icecast:8000/` | 200 OK, Icecast server online |
| 52 | `POST /channels` | 201 Created, channel created for broadcast |
| 53 | Poll Icecast mount `/channels/:id.mp3` | Registered by Liquidsoap dynamic sync |
| 54 | Live stream HTTP handshake | 200 OK, `Content-Type: audio/mpeg`, ICY headers |
| 55 | Stream byte capture (4s) | Continuous stream data $> 30\text{ KB}$ at 128kbps |
| 56 | Audio energy / non-silence verification | `ffmpeg` volumedetect `mean_volume > -60 dB` (non-silent audio frames) |
| 57 | Listener telemetry | `/admin/stats` tracks listener connection & disconnection (0 $\rightarrow$ 1 $\rightarrow$ 0) |

---

## Auth Matrix Covered

| Route | 401 (no token) | 401 (bad token) | 403 (user token) |
|---|---|---|---|
| `GET /users/me` | ✅ #9 | ✅ #10 | — |
| `POST /channels` | ✅ #19 | — | — |
| `POST /channels/:id/subreddits` | ✅ #20 | ✅ #20 | — |
| `DELETE /channels/:id/subreddits/:subName` | ✅ #21 | ✅ #21 | — |
| `GET /channels/:id/subreddits` | ✅ #22 | ✅ #22 | — |
| `GET /channels/active` | ✅ #25 | ✅ #25 | — |
| `GET /channels/:id/next-track` | ✅ #39 | ✅ #39 | — |
| `POST /admin/feeds/scrape` | ✅ #26 | — | ✅ #27 |
| `GET /admin/feeds/subreddits` | ✅ #28 | — | ✅ #29 |
| `DELETE /admin/feeds/cache` | ✅ #30 | — | ✅ #31 |
| `GET /admin/channels/:id/topics` | ✅ #32 | — | ✅ #33 |


