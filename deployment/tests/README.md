# E2E Tests — Blackbox Suite

One command, full stack, real Reddit. 27 scenarios against a freshly composed environment: Postgres, MinIO, browserless, and the app — with a seeded admin (from `.env`) and a non-admin test user.

## Running

```sh
./deployment/tests/run-docker-test.sh
```

Exit code `0` = all 27 pass. The suite must pass from a **clean state** (containers + volumes are torn down after every run).

**How it works**: the test container curls the app via `host.docker.internal:3000` on an isolated network. A `seed` service injects the non-admin fixture user (`user@socialradio.com` / `UserPass123!`) only after the app healthcheck confirms the schema exists. The test script itself is a thin wrapper — orchestration lives in compose.

## Scenario inventory — all 27, in order

### Phase 1: Healthcheck & Unauthenticated Negatives
*The app must be alive and refuse anonymous access.*

| # | Scenario | Expected |
|---|---|---|
| 1 | `GET /healthcheck` | 200 |
| 2 | `POST /auth/login` empty body | 400 |
| 3 | `POST /auth/login` invalid email format | 400 |
| 4 | `POST /auth/login` wrong admin password | 401 |
| 5 | `POST /auth/login` non-existent email | 401 |
| 6 | `GET /users/me` no token | 401 |
| 7 | `GET /users/me` malformed JWT | 401 |
| 8 | `GET /channels` no token | 401 |

### Phase 2: Authentication & Profile
*Both roles can log in; the token works.*

| # | Scenario | Expected |
|---|---|---|
| 9 | Admin login | 200/201 |
| 10 | `GET /users/me` with admin token | 200 |
| 11 | Regular user login (fixture) | 200/201 |

### Phase 3: Channel CRUD & Subreddits
*Channel lifecycle and subscription semantics.*

| # | Scenario | Expected |
|---|---|---|
| 12 | `POST /channels` empty name | 400 |
| 13 | `POST /channels` create | 201 |
| 14 | `GET /channels` list | 200 |
| 15 | Subscribe to fake UUID channel | 404 |
| 16 | Subscribe `r/AskReddit` | 200/201 |
| 17 | **Duplicate** subscribe `r/AskReddit` (idempotency) | 200/201 |
| 18 | Unsubscribe `r/AskReddit` | 200 |
| 19 | Subscribe `r/technology` | 201 |

### Phase 4: RBAC & Admin Integration
*Admin-only routes enforce 401/403, then do real work against live Reddit.*

| # | Scenario | Expected |
|---|---|---|
| 20 | Scrape without token | 401 |
| 21 | Scrape with tampered JWT | 401 |
| 22 | Scrape with regular user token | 403 |
| 23 | Channel topics with regular user token | 403 |
| 24 | **Scrape `r/technology` with admin token** (real browserless + Reddit) | 200/201 + `scrapedPostsCount` |
| 25 | `GET /admin/feeds/subreddits` — subreddit visible with post count | 200 |
| 26 | `GET /admin/channels/:id/topics` — a topic exists from scraped posts | 200 |
| 27 | `DELETE /admin/feeds/cache` | 200 |

## What this suite verifies — and what it doesn't

**Verified**: the full RBAC matrix (401/403/200 across both roles), login validation contract, channel + subscription semantics, the real scrape pipeline end-to-end (browserless → Reddit → DB → topics).

**Not covered** (known gaps):
- **`GET /channels/:id/playlist.m3u8` and `GET /channels/:id/chunks/:filename` are not tested at all** — neither the streaming behaviour nor their auth state (they're currently unauthenticated; see `src/channel/README.md`).
- Playlist/chunk serving, queue replenishment, and the 120s idle fast-forward only exercise via manual/unit tests.
- Case 24 asserts `scrapedPostsCount` is *present*, not its value.
