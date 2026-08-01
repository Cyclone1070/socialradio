# E2E Tests — Blackbox Suite

One command, full stack, real Reddit. 34 scenarios against a freshly composed environment: Postgres, MinIO, browserless, and the app — with a seeded admin (from `.env`) and a non-admin test user.

## Running

```sh
./deployment/tests/run-docker-test.sh
```

Exit code `0` = all 34 pass. The suite must pass from a **clean state** (containers + volumes are torn down after every run).

**How it works**: the test container curls the app via `host.docker.internal:3000` on an isolated network. A `seed` service injects the non-admin fixture user (`user@socialradio.com` / `UserPass123!`) only after the app healthcheck confirms the schema exists. The test script itself is a thin wrapper — orchestration lives in compose.

**Structure**: cases are grouped **by feature** (not by happy/unhappy). Within each feature, happy paths come first, then that feature's failure cases. Every protected endpoint asserts its own auth negatives — a route missing its guard decorator fails the suite.

## Scenario inventory — all 34, in order

### Section 1: Healthcheck
*The app must be alive.*

| # | Scenario | Expected |
|---|---|---|
| 1 | `GET /healthcheck` | 200 |

### Section 2: Auth & Identity
*Login contract, token validity, profile.*

| # | Scenario | Expected |
|---|---|---|
| 2 | Admin login | 200/201 |
| 3 | `GET /users/me` with admin token | 200 |
| 4 | Regular user login (fixture) | 200/201 |
| 5 | Login empty body | 400 |
| 6 | Login invalid email format | 400 |
| 7 | Login wrong password | 401 |
| 8 | Login non-existent email | 401 |
| 9 | `GET /users/me` no token | 401 |
| 10 | `GET /users/me` malformed JWT | 401 |

### Section 3: Channels & Subreddits
*Channel lifecycle, subscription semantics, and this feature's auth negatives.*

| # | Scenario | Expected |
|---|---|---|
| 11 | `POST /channels` create | 201 |
| 12 | `GET /channels` list | 200 |
| 13 | Subscribe `r/AskReddit` | 200/201 |
| 14 | **Duplicate** subscribe `r/AskReddit` (idempotency) | 200/201 |
| 15 | Unsubscribe `r/AskReddit` | 200 |
| 16 | Subscribe `r/technology` | 201 |
| 17 | `POST /channels` empty name | 400 |
| 18 | Subscribe to fake UUID channel | 404 |
| 19 | `POST /channels` no token | 401 |
| 20 | Subscribe no token | 401 |
| 21 | Unsubscribe no token | 401 |

### Section 4: Admin & Feeds
*Admin-only routes work with admin token, and each asserts its own 401 (no token) and 403 (regular token).*

| # | Scenario | Expected |
|---|---|---|
| 22 | **Scrape `r/technology` with admin token** (real browserless + Reddit) | 200/201 + `scrapedPostsCount` |
| 23 | `GET /admin/feeds/subreddits` (admin) | 200 |
| 24 | `GET /admin/channels/:id/topics` (admin) | 200 |
| 25 | `DELETE /admin/feeds/cache` (admin) | 200 |
| 26 | Scrape no token | 401 |
| 27 | Scrape tampered JWT | 401 |
| 28 | Scrape regular user token | 403 |
| 29 | Subreddits no token | 401 |
| 30 | Subreddits regular user token | 403 |
| 31 | Cache no token | 401 |
| 32 | Cache regular user token | 403 |
| 33 | Topics no token | 401 |
| 34 | Topics regular user token | 403 |

## Auth matrix covered

| Route | 401 (no token) | 401 (bad token) | 403 (user token) |
|---|---|---|---|
| `GET /users/me` | ✅ #9 | ✅ #10 | — |
| `POST /channels` | ✅ #19 | — | — |
| `POST /channels/:id/subreddits` | ✅ #20 | — | — |
| `DELETE /channels/:id/subreddits/:subName` | ✅ #21 | — | — |
| `POST /admin/feeds/scrape` | ✅ #26 | ✅ #27 | ✅ #28 |
| `GET /admin/feeds/subreddits` | ✅ #29 | — | ✅ #30 |
| `DELETE /admin/feeds/cache` | ✅ #31 | — | ✅ #32 |
| `GET /admin/channels/:id/topics` | ✅ #33 | — | ✅ #34 |
| `GET /channels/:id/playlist.m3u8` | ❌ excluded | — | — |
| `GET /channels/:id/chunks/:filename` | ❌ excluded | — | — |

## What this suite verifies — and what it doesn't

**Verified**: per-route guard wiring (401/403 matrix above), login validation contract, channel + subscription semantics, the real scrape pipeline end-to-end (browserless → Reddit → DB → topics).

**Not covered** (known gaps):
- **`GET /channels/:id/playlist.m3u8` and `GET /channels/:id/chunks/:filename` are deliberately excluded** — neither their streaming behaviour nor their auth state (currently unauthenticated) is tested. See `src/channel/README.md`.
- Unsubscribe on a non-existent subreddit → 404 branch, and subscribe with an invalid body, are untested.
- Case 22 asserts `scrapedPostsCount` is *present*, not its value.
- Playlist/chunk serving, queue replenishment, and the 120s idle fast-forward are unit-tested only.
