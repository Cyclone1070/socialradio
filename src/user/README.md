# User — Profiles

Minimal user identity. Users are created by the database migration (admin) and the test fixture (regular user) — there is no public registration endpoint.

## Public API

| Method | Path | Auth | Behaviour |
|---|---|---|---|
| `GET` | `/users/me` | JWT | Returns the caller's profile: `{ id, email, createdAt }`. Identity comes from the JWT `sub` claim — no email lookup. |

## Behaviour

- The only user-facing read endpoint; the app has no user directory beyond this.
- Roles are set at seeding time and only travel in the JWT (`role` claim) — see `src/auth/README.md`.
