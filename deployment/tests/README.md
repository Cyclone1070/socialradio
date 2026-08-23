# E2E Tests — Blackbox Suite

One command, full stack, real Reddit. 37 scenarios against a freshly composed environment: Postgres, MinIO, browserless, and the app — with a seeded admin (from `.env`) and a non-admin test user.

## Running

```sh
./deployment/tests/run-docker-test.sh
```

Exit code `0` = all 37 pass. The suite must pass from a **clean state** (containers + volumes are torn down after every run).

**How it works**: the test container curls the app via `host.docker.internal:3000` on an isolated network. A `seed` service injects the non-admin fixture user (`user@socialradio.com` / `UserPass123!`) only after the app healthcheck confirms the schema exists. The test script itself is a thin wrapper — orchestration lives in compose.

**SQL pattern**: one access point — the `psql_run` helper in `docker-test.sh` runs every
database change (boot fixtures like `seed-test-user.sql` at suite start, mid-suite fixtures
like `dead-sub-fixture.sql` with `-v` psql variables). No other SQL paths exist.

**Assertion style**: every case checks more than status. Responses are verified with `jq` (field presence, values, error bodies — e.g. "Invalid credentials" on both login failures, proving no user enumeration). Mutations are **read back**: subscribe/unsubscribe are followed by `GET /channels/:id/subreddits` to prove the link changed. Error responses must confirm their status code in the body.

**Structure**: cases are grouped **by feature**. Within each feature, happy paths come first, then that feature's failure cases. Every protected endpoint asserts its own auth negatives — a route missing its guard decorator fails the suite.

## Scenario inventory — all 37, in order

### Section 1: Healthcheck
*The app must be alive.*

| # | Scenario | Expected |
|---|---|---|
| 1 | `GET /healthcheck` | 200, `status: "ok"`, timestamp present |

### Section 2: Auth & Identity
*Login contract, token validity, profile.*

| # | Scenario | Expected |
|---|---|---|
| 2 | Admin login | 2xx + accessToken |
| 3 | `GET /users/me` with admin token | email matches admin, id + createdAt present |
| 4 | Regular user login (fixture) | 2xx + accessToken |
| 5 | Login empty body | 400 + validation messages |
| 6 | Login invalid email format | 400 + message mentions email |
| 7 | Login wrong password | 401 + "Invalid credentials" |
| 8 | Login non-existent email | 401 + "Invalid credentials" (same message — no enumeration) |
| 9 | `GET /users/me` no token | 401 body confirms |
| 10 | `GET /users/me` malformed JWT | 401 body confirms |

### Section 3: Channels & Subreddits
*Channel lifecycle, subscription semantics (verified by read-back), and this feature's auth negatives.*

| # | Scenario | Expected |
|---|---|---|
| 11 | `POST /channels` create | 201, name matches, visibility + createdAt present |
| 12 | `GET /channels` list | contains the created channel |
| 13 | Subscribe `r/AskReddit` | empty body, **read-back: AskReddit in list** |
| 14 | **Duplicate** subscribe `r/AskReddit` | empty body, **read-back: exactly one AskReddit** |
| 15 | Unsubscribe `r/AskReddit` | empty body, **read-back: AskReddit gone** |
| 16 | **Re-subscribe** `r/AskReddit` (proves the link is fully recreatable) | empty body, **read-back: AskReddit back** |
| 17 | `POST /channels` empty name | 400 + message mentions name |
| 18 | Subscribe to fake UUID channel | 404 + "Channel not found" |
| 19 | `POST /channels` no token | 401 body confirms |
| 20 | Subscribe no token | 401 body confirms |
| 21 | Unsubscribe no token | 401 body confirms |
| 22 | **Subscribe invalid body** (non-string `subredditName`) | 400 + body confirms |
| 23 | **Unsubscribe a sub that was never subscribed** | 404 + "Subreddit not found" |

### Section 4: Topics, Scraping & Active Pool
*Topic clustering, deficit-triggered scraping, lazy 20-sub suppression, rotation trigger, and dead sub cascade.*

| # | Scenario | Expected |
|---|---|---|
| 24 | SQL fixture: seed 19 active subs with posts | read-back: 20 subreddits subscribed |
| 25 | `GET /admin/channels/:id/topics` (active pool = 19 < 20) | 200, topic id present — **triggers AskReddit scrape** |
| 26 | Poll `GET /admin/feeds/subreddits` | AskReddit has `postCount > 0` (active pool reaches 20) |
| 27 | SQL fixture: inject dead sub behind API gate | read-back: 21 subreddits subscribed |
| 28 | `GET /admin/channels/:id/topics` (active pool = 20 >= 20) | 200, topic resolved, **0 scrapes triggered** (dead sub remains) |
| 29 | Mark 1 post complete (active drops to 19) + `GET .../topics` | triggers dead sub scrape $\rightarrow$ dead sub **auto-unsubscribed** |

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

## Auth matrix covered

| Route | 401 (no token) | 401 (bad token) | 403 (user token) |
|---|---|---|---|
| `GET /users/me` | ✅ #9 | ✅ #10 | — |
| `POST /channels` | ✅ #19 | — | — |
| `POST /channels/:id/subreddits` | ✅ #20 | — | — |
| `DELETE /channels/:id/subreddits/:subName` | ✅ #21 | — | — |
| `POST /admin/feeds/scrape` | ✅ #30 | — | ✅ #31 |
| `GET /admin/feeds/subreddits` | ✅ #32 | — | ✅ #33 |
| `DELETE /admin/feeds/cache` | ✅ #34 | — | ✅ #35 |
| `GET /admin/channels/:id/topics` | ✅ #36 | — | ✅ #37 |
| `GET /channels/:id/subreddits` (read-back) | — | — | — |
| `GET /channels/:id/playlist.m3u8` | ❌ excluded | — | — |
| `GET /channels/:id/chunks/:filename` | ❌ excluded | — | — |

## What this suite verifies — and what it doesn't

**Verified**: per-route guard wiring (401/403 matrix above), login validation + no-user-enumeration contract, channel + subscription semantics **via read-back** (create, idempotent subscribe, unsubscribe, re-subscribe), and the real scrape pipeline end-to-end (browserless → Reddit → DB → topics, with lazy pool suppression and rotation deficit triggering).

**Not covered** (known gaps):
- **`GET /channels/:id/playlist.m3u8` and `GET /channels/:id/chunks/:filename` are deliberately excluded** — neither their streaming behaviour nor their auth state (currently unauthenticated) is tested. See `src/channel/README.md`.
- Playlist/chunk serving, queue replenishment, and the 120s idle fast-forward are unit-tested only.
