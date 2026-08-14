# Logging Architecture & Contract

SocialRadio uses structured JSON logging via **Pino** (`pino`, `pino-http`, and `nestjs-pino`). All log events emit single-line JSON to standard output (`stdout`), making them container-native and easily queryable in production log aggregators.

---

## 1. Module Structure

- **`src/logging/logging.module.ts`**: Provides `LoggingModule.forRoot()` imported once by `AppModule`.
- **`createServiceLogger(context)`**: Factory function to instantiate lightweight, context-bound `PinoLogger` instances inside NestJS services without requiring Dependency Injection churn in unit tests.
- **`src/logging/logging.spec.ts`**: Contract test verifying HTTP request logging and JSON payload structure.

---

## 2. Log Contract & Payload Schema

All operational logs emit an object with structured metadata fields alongside a human-readable message string (`pino.info({ ...fields }, 'message')`).

### Common Metadata Fields

| Field | Type | Description | Example |
|---|---|---|---|
| `ms` / `durationMs` | `number` | Latency or elapsed execution time in milliseconds | `42`, `1250` |
| `scrapeId` | `string` | UUID correlating all log lines across a single scrape walk iteration | `'a1b2c3d4-...'` |
| `userId` | `string` | User ID associated with auth or registration actions | `'uuid-1234'` |
| `channelId` | `string` | Channel context for queue generation or playback | `'chan-1'` |
| `subreddit` / `sub` | `string` | Subreddit target for scraping or subscription | `'webdev'` |
| `postIds` | `string[]` | Post IDs grouped in a voice track generation request | `['post-1', 'post-2']` |
| `durationSeconds` | `number` | Audio track duration output by TTS | `30.0` |
| `reason` / `decision` | `string` | Explicit guard verdict (e.g. `'in-flight claim'`, `'cooldown'`, `'stale'`, `'exhausted'`, `'fresh'`) | `'stale'` |

---

## 3. Log Level Conventions

- **`debug`**: Verbose internal state decisions (e.g., cache hits, per-subreddit queue decisions, page-load timings).
- **`info`**: Operational milestones (e.g., user registered, LLM script generated, TTS track generated, scrape walk starting/finished).
- **`warn`**: Recoverable issues, skipped actions, or security guard rejections (e.g., login failure, subreddit validation reject, scrape skipped due to cooldown).
- **`error`**: Failures affecting single jobs or operations (e.g., voice track generation failure, scraper connection retry error).
- **`fatal`**: Process-level crashes or bootstrap failure.

---

## 4. Environment & Container Configuration

- **`LOG_LEVEL`**: Controls logging verbosity (`silent`, `error`, `warn`, `info`, `debug`). Defaults to `info` in production and `silent` in Jest test suites via `jest.logging-setup.js`.
- **`LOG_PRETTY=1`**: Enables human-readable colorized formatting using `pino-pretty` (primarily for local development in `reddit-fetcher`).
- **Docker Log Rotation**: Configured via `docker-compose.yml` (`max-size: "10m"`, `max-file: "3"`) to prevent container stdout logs from filling disk storage.
