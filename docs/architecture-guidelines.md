# Architecture Guidelines

This document provides decision rules for file placement, code organization, streaming mechanics, and architecture guardrails when adding or modifying features in Social Radio.

---

## Core Architectural Rules

1. **Feature Slices (`src/<feature>/`)**
   - Modules are organized strictly by **Domain**, not by technical or functional concern (e.g. `channel/` contains `playback.service.ts` and `queue.service.ts`; `user/` contains auth and registration; `content/` contains scraping and feed storage).
   - Slices **may** import each other, but only along the edges declared in `src/architecture.spec.ts` (`SLICE_EDGES`). An edge is one-directional; adding one is a one-line diff in that list, which is what keeps the graph acyclic by construction instead of by memory.
   - A contract lives in the slice that **implements** it (`content/content.contract.ts`), never in a shared folder. A caller that imports it creates a visible `channel -> content` edge.
   - A payload type lives in the slice that **produces** it (`content/types/post.types.ts`). There is no `src/domain/` package: sharing a type is just an import along an allowed edge.
   - Cross-slice entity references use scalar string IDs (`<name>Id: string`) instead of ORM relation objects, and an entity file never imports a peer slice's entity.

2. **Infrastructure (`src/infrastructure/`)**
   - Infrastructure sits **below** every slice: slices import it freely, it imports no slice.
   - The one exception is `infrastructure/database/schemas/`, which must name the entity classes it maps; it may import entity files and nothing else.

3. **Architecture Guardrails (Enforced via `src/architecture.spec.ts`)**
   - **Rule 1: Slice Edge Allowlist**: every cross-slice import must appear in `SLICE_EDGES`.
   - **Rule 2: Infrastructure Is Below**: infrastructure imports no slice; the schema mapping imports only entity files.
   - **Rule 3: One Package**: production code never imports past `src/` by relative path.
   - **Rule 4: No Peer Entities**: an entity file imports no entity from another slice.
   - **Rule 5: One Table, One Schema, One Class**: every schema class owns one table and is declared in `<slice>/entities/<name>.entity.ts`.
   - **Rule 6: Plain Entities**: entity files contain no ORM decorators.
   - **Rule 7: Entity Encapsulation**: Date getters clone, array getters cannot leak.
   - **Rule 8: Registration Matches Injection**: `MikroOrmModule.forFeature` registers exactly the schemas that are injected.
   - **Rule 9: Persistence Goes Through the ORM**: no `getConnection`, no `.raw(`.
   - **Rule 10: No Type-System Bypasses**: production code uses no `as unknown as`.
   - Every spec is named after the file it tests; a suite may not outlive its subject.

   The spec file is the authority, not this list.

4. **Live Audio Streaming Architecture (Native HLS & Lazy Virtual Clock)**
   - RFC 8216-compliant HLS playlists served dynamically via `GET /channels/:channelId/live.m3u8`.
   - Scale-to-zero compute: Segment playhead advances on-demand via a lazy-evaluated virtual clock engine during manifest requests.
   - **CDN-Native Edge Caching**: Manifests are tagged with `Cache-Control: public, max-age=2, s-maxage=2`, collapsing concurrent listener requests at the edge. The $\le 0.5$ req/s per active channel origin poll rate is a **deployment requirement, not a code guarantee**: it follows from those headers plus the CDN's cache and request collapsing, and no CDN configuration is checked into this repository.
   - **Idle Freeze & Wakeup**: Channels with no manifest requests for $> 10$ minutes freeze their playhead state cleanly, pausing background AI script synthesis and TTS generation until a listener returns.
   - **Low Runway Replenishment**: When fewer than 4 segments remain ahead in queue, `bufferAhead` asynchronously fills the runway.
   - Static audio chunks (`.mp3`) are served directly from object storage (SeaweedFS in local docker, R2/S3 in production), which is why they are uploaded with `Cache-Control: public, max-age=31536000` — long-lived but not `immutable`.

5. **Sidecar Placement & Docker Orchestration**
   - Independent background sidecars live at the repository root. There are two, and each owns a boundary the app talks to over HTTP by URL alone: `reddit-fetcher/` (browserless, reddit browsing, the pacing queue) and `voice-service/` (the TTS engine, voice casting, turn concatenation, and the measured length of the audio it produced).
   - Container orchestration is centralized exclusively in [`deployment/docker/docker-compose.yml`](../deployment/docker/docker-compose.yml).

---

## File Placement & Naming Guide

| What are you adding? | File Placement | File Naming | Export / Token Name |
| :--- | :--- | :--- | :--- |
| **HTTP Controller** | `src/<feature>/` | `<name>.controller.ts` | `[Name]Controller` |
| **HTTP Request/Response DTO** | `src/<feature>/dto/` | `<name>.dto.ts` | `[Name]Dto` |
| **Database entity (MikroORM `EntitySchema`)** | `src/<feature>/entities/` | `<entity>.entity.ts` | `[Name]` (POCO entity class) |
| **Feature Service** | `src/<feature>/` | `<service>.service.ts` | `[Name]Service` |
| **Feature-Internal Interface/Helper** | `src/<feature>/interfaces/` or `src/<feature>/utils/` | `<name>.interface.ts` or `<name>.util.ts` | `[Name]` |
| **Cross-Slice Service Contract** | `src/<feature>/` (the implementer) | `<name>.contract.ts` | `export abstract class [Feature]Contract` |
| **Payload type read by another slice** | `src/<feature>/types/` (the producer) | `<concept>.types.ts` | `export interface [Concept]Data` |
| **Root-Level Sidecar Service** | `<service>/` | `Dockerfile`, `src/`, `package.json` | Containerized daemon |
| **Docker Compose Services** | `deployment/docker/` | `docker-compose.yml` | `[Service]` container |

---

## Decision Guide: Where Does This Code Go?

1. **Is it HTTP-facing (Routing / Guards / Request DTOs)?**
   → Put in `src/<feature>/` or `src/<feature>/dto/`.

2. **Is it Database / Persistence?**
   → Put in `src/<feature>/entities/`.

3. **Is it feature business logic?**
   → Put in `src/<feature>/`.

4. **Is it used by 2+ feature slices?**
   → Put it in the slice that owns or produces it, and import it from there. If that would create an edge back, the slice is either the wrong shape or the code belongs to neither: add a slice that owns it.

5. **Is it reusable technical infrastructure (Storage, DB connection, Logger)?**
   → Put in `src/infrastructure/<service>/`.

6. **Is it a dedicated daemon/runtime sidecar?**
   → Put in `<sidecar>/` at root, wire into `deployment/docker/docker-compose.yml`.
