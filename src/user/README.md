# Auth — Login, JWT & RBAC

Identity and access control for the whole app. One login endpoint, minimal stateless tokens, two guard layers.

## Public API

| Method | Path | Auth | Behaviour |
|---|---|---|---|
| `POST` | `/auth/login` | none | Body: `{ email, password }`. Returns `{ accessToken }`. |

## Behaviour — login contract

- **400** — malformed body (missing/empty fields, invalid email format). Class-validator DTOs enforce this via the global `ValidationPipe`.
- **401** — wrong password **or non-existent email — deliberately identical responses.** No user enumeration: you can't tell which one you hit.
- **200/201** — success. The token is the whole session; there are no refresh tokens.

## JWT claims — minimal by design

```
{ sub: <user id>, role: 'admin' | 'user' }
```

No email, no name, no expiry surface beyond the token's own — headers stay small and no PII rides along.

## Guard behaviour (the two layers)

- **`JwtAuthGuard`** (everything except `/healthcheck` and `/auth/login`): missing or malformed token → **401**.
- **`RolesGuard` + `@Roles('admin')`** (admin namespace): valid token but `role !== 'admin'` → **403**.

| Namespace | Rule |
|---|---|
| Public | `GET /healthcheck` |
| Authenticated | login, `/users/me`, channels, subreddits, playlist/chunks |
| Admin | `/admin/feeds/*`, `/admin/channels/:id/topics` |
