# E2E Test Suite — Automated Manual QA Gate

> **CRITICAL RULE FOR ALL AGENTS AND DEVELOPERS**:
> The sole purpose of this E2E suite is to **automate manual QA testing**. Every test case in this suite represents an engineer manually spinning up the entire Docker stack and curling endpoints in their terminal to inspect real, live behavior.
> 
> **Zero Tolerance for False Passes**: There must NEVER be a scenario where a bug exists during manual verification but the E2E test passes. A passing test that hides a manual QA failure is a critical protocol violation. E2E is the **final, non-negotiable QA gate** before release.

---

## Architecture & Mechanics

- **Clean State Isolation**: The suite runs from a clean state. Containers and volumes are torn down after every run (`run-docker-test.sh`).
- **Network & Host Isolation**: The test container curls the app via `host.docker.internal:3000` on an isolated Docker network. A `seed` service injects fixture data only after the app healthcheck confirms the schema is migrated.
- **SQL Pattern**: One access point — the `psql_run` helper in `docker-test.sh` runs every database change (boot fixtures like `seed-test-user.sql` at suite start, mid-suite fixtures like `dead-sub-fixture.sql` with `-v` psql variables). No other SQL paths exist.
- **Read-Back Assertions**: Every mutation is verified by read-back: subscribe/unsubscribe are followed by `GET /channels/:id/subreddits` to prove the link changed in the database. Responses are parsed with `jq` to verify structure and values.
- **Auth Guard Verification**: Every protected endpoint asserts its own auth negatives — any route missing its guard decorator immediately fails the suite.

---

## Running the Suite

```sh
./deployment/tests/run-docker-test.sh
```

Exit code `0` = all scenarios pass.

---

## Scenario Inventory

### Section 1: Healthcheck
*The app must be alive.*

| # | Scenario | Expected |
|---|---|---|
| 1 | `GET /healthcheck` | 200, `status: "ok"`, timestamp present |

### Section 2: Auth & Identity
*Login contract, token validity, profile, and user enumeration safety.*

| # | Scenario | Expected |
|---|---|---|
| 2 | Admin login | 2xx + accessToken |
| 3 | `GET /users/me` with admin token | email matches admin, id + createdAt present |
| 4 | Regular user login (fixture) | 2xx + accessToken |
| 5 | Login empty body | 400 + validation messages |
| 6 | Login invalid email format | 400 + message mentions email |
| 7 | Login wrong password | 401 + "Invalid credentials" |
| 8 | Login non-existent email | 401 + "Invalid credentials" (same message — no user enumeration) |
| 9 | `GET /users/me` no token | 401 body confirms |
| 10 | `GET /users/me` malformed JWT | 401 body confirms |

### Section 3: Channels & Subreddits
*Channel lifecycle, subscription semantics (verified by read-back), and route guards.*

| # | Scenario | Expected |
|---|---|---|
| 11 | `POST /channels` create | 201, name matches, visibility + createdAt present |
| 12 | `GET /channels` list | contains the created channel |
| 13 | Subscribe `r/AskReddit` | empty body, **read-back: AskReddit in list** |
| 14 | **Duplicate** subscribe `r/AskReddit` | empty body, **read-back: exactly one AskReddit** |
| 15 | Unsubscribe `r/AskReddit` | empty body, **read-back: AskReddit gone** |
| 16 | **Re-subscribe** `r/AskReddit` (proves link is fully recreatable) | empty body, **read-back: AskReddit back** |
| 17 | `POST /channels` empty name | 400 + message mentions name |
| 18 | Subscribe to fake UUID channel | 404 + "Channel not found" |
| 19 | `POST /channels` no token | 401 body confirms |
| 20 | Subscribe no token | 401 body confirms |
| 21 | Unsubscribe no token | 401 body confirms |
| 22 | **Subscribe invalid body** (non-string `subredditName`) | 400 + body confirms |
| 23 | **Unsubscribe a sub that was never subscribed** | 404 + "Subreddit not found" |

### Section 4: Topics, Scraping & Active Pool
*Topic clustering, proactive pool deficit triggering, lazy 20-sub suppression, and dead sub cascade.*

| # | Scenario | Expected |
|---|---|---|
| 24 | SQL fixture: seed 19 active subs with posts | read-back: 20 subreddits subscribed |
| 25 | `GET /admin/channels/:id/topics` (active pool = 19 < 20) | 200, topic id present — **triggers AskReddit scrape** |
| 26 | Poll `GET /admin/feeds/subreddits` | AskReddit has `postCount > 0` (active pool reaches 20) |
| 27 | SQL fixture: inject dead sub behind API gate | read-back: 21 subreddits subscribed |
| 28 | `GET /admin/channels/:id/topics` (active pool = 20 >= 20) | 200, topic resolved, **0 scrapes triggered** (dead sub remains) |
| 29 | Mark 1 post complete (active drops to 19) + `GET .../topics` | triggers dead sub scrape $\rightarrow$ dead sub **auto-unsubscribed via cascade** |

### Section 5: Auth Negatives
*Admin-only routes assert their 401 (no token) and 403 (regular user token).*

| # | Scenario | Expected |
|---|---|---|
| 30 | `POST /admin/feeds/scrape` no token | 401 body confirms |
| 31 | `POST /admin/feeds/scrape` regular user token | 403 body confirms |
| 32 | `GET /admin/feeds/subreddits` no token | 401 body confirms |
| 33 | `GET /admin/feeds/subreddits` regular user token | 403 body confirms |
| 34 | `DELETE /admin/feeds/cache` no token | 401 body confirms |
| 35 | `DELETE /admin/feeds/cache` regular user token | 403 body confirms |
| 36 | `GET /admin/channels/:id/topics` no token | 401 body confirms |
| 37 | `GET /admin/channels/:id/topics` regular user token | 403 body confirms |

### Section 6: Playback, Idle & Queue Safety
*Playback FIFO progression, idle resource conservation, cold-start batch generation, tail-resume, and streamer safety.*

| # | Scenario | Expected |
|---|---|---|
| 38 | Cold-start empty channel `GET /channels/:id/next-track` | 200 OK, returns Track #1, sets `currentSegmentId` |
| 39 | Tail-resume reconnect `GET /channels/:id/next-track?resuming=true` | 200 OK, returns current segment with `startOffsetSeconds > 0` |
| 40 | Sequential `GET /channels/:id/next-track` | 200 OK, FIFO advancement (`playOrder` increments) |
| 41 | Subscribe dead sub to empty channel + `GET .../next-track` | 200 OK (returns filler music/ad, doesn't 500 or hang) |
| 42 | Emergency fallback (empty storage) | 200 OK, returns `fallback-jingle` |

### Section 7: Live AI Talk Generation & MinIO Blob Storage
*Real-world AI synthesis pipeline and S3 object storage verification.*

| # | Scenario | Expected |
|---|---|---|
| 43 | Trigger `bufferAhead` with scraped Reddit topic | 200 OK, synthesizes live multi-turn script with OpenCode + Google TTS |
| 44 | Poll TalkSegment completion | `status == 'ready'`, duration $> 0$, multi-turn dialogue array |
| 45 | MinIO Blob Storage Verification | Queries MinIO S3 API -> confirms generated `.mp3` blob exists and size $> 10\text{ KB}$ |

---

## Auth Matrix Covered

| Route | 401 (no token) | 401 (bad token) | 403 (user token) |
|---|---|---|---|
| `GET /users/me` | ✅ #9 | ✅ #10 | — |
| `POST /channels` | ✅ #19 | — | — |
| `POST /channels/:id/subreddits` | ✅ #20 | — | — |
| `DELETE /channels/:id/subreddits/:subName` | ✅ #21 | — | — |
| `GET /channels/:id/next-track` | ✅ #19-guard | — | — |
| `POST /admin/feeds/scrape` | ✅ #30 | — | ✅ #31 |
| `GET /admin/feeds/subreddits` | ✅ #32 | — | ✅ #33 |
| `DELETE /admin/feeds/cache` | ✅ #34 | — | ✅ #35 |
| `GET /admin/channels/:id/topics` | ✅ #36 | — | ✅ #37 |
| `GET /channels/:id/subreddits` (read-back) | — | — | — |

