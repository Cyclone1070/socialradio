# Domain — Shared Types & Entities

Cross-slice contracts that don't belong to any single feature: storage interface, audio file references, topic interface, and shared entities (channel, subreddit, segment types).

## Behaviour

- **Interfaces over implementations**: slices depend on these types (e.g. `StorageService`), never on concrete services from other slices.
- **Entities** here are the cross-cutting ones (channel, subreddit); feature-specific tables live in their own slice (`feed/entities`, `radio/entities`, `media/entities`).
- Segment taxonomy lives here: **Talk / Song / Ad / Jingle** — the four things a channel queue can hold.
