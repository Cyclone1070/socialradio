# Healthcheck — Liveness

The one public endpoint: `GET /healthcheck` → **200** when the app is up.

## Behaviour

- No auth, no DB dependency — it answers "is the process alive?", which is all the docker healthcheck needs.
- Used by compose (`app` service healthcheck) and the E2E suite as the "stack is ready" signal before anything else runs.
