# SocialRadio Backend

AI-powered radio station backend. It scrapes Reddit for real conversations, clusters posts into topics, generates call-in talk-radio scripts with an LLM, synthesises speech with TTS, and streams the result as audio segments per channel.

**Pipeline at a glance:**

```
Reddit → scrape (content) → cluster (channel) → script (script) → TTS (voice) → queue + stream (channel)
```

## Feature Slices & Infrastructure

Each slice has a `README.md` describing its **behaviour** — rules, flows, and intent. Technical details live in the code.

| Slice / Module | Purpose | Behaviour doc |
|---|---|---|
| `src/content` | Reddit content acquisition — scraping, filtering, caching | [README](src/content/README.md) |
| `src/channel` | User channels, station queue, playback & segment streaming | [README](src/channel/README.md) |
| `src/script` | Call-in talk-radio script generation with multi-host dialogue via LLM | — |
| `src/voice` | Text-to-speech voice synthesis via Google Cloud TTS | — |
| `src/media` | Music / ad / jingle library for station queue fillers | [README](src/media/README.md) |
| `src/user` | User authentication, identity, profile management | [README](src/user/README.md) |
| `src/domain` | Shared cross-slice contracts and data types | [README](src/domain/README.md) |
| `src/infrastructure/database` | MikroORM schema definitions & migrations | [README](src/infrastructure/database/README.md) |
| `src/infrastructure/storage` | Object storage abstraction (S3/MinIO) | [README](src/infrastructure/storage/README.md) |
| `src/infrastructure/auth` | Cross-cutting JWT & RBAC guards and decorators | — |
| `src/infrastructure/logging` | Centralized JSON logging module & Pino contract | [README](src/infrastructure/logging/README.md) |
| `src/infrastructure/healthcheck` | Liveness probe endpoint | [README](src/infrastructure/healthcheck/README.md) |
| `deployment/tests` | Blackbox Docker E2E suite (41 cases) | [README](deployment/tests/README.md) |

## Running

```sh
cp .env.example .env    # fill in ADMIN_EMAIL / ADMIN_PASSWORD / JWT_SECRET / GEMINI_API_KEY
docker compose -f deployment/docker/docker-compose.yml up --build
```

E2E suite (spins up the full stack — Postgres, MinIO, browserless, the migration runner, reddit-fetcher, and the app — plus test fixtures):

```sh
./deployment/tests/run-docker-test.sh
```
