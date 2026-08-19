# Architecture Guidelines

This document provides decision rules for file placement, code organization, streaming mechanics, and architecture guardrails when adding or modifying features in Social Radio.

---

## Core Architectural Rules

1. **Feature Slices (`src/<feature>/`)**
   - Modules are organized strictly by **Domain**, not by technical or functional concern (e.g. `channel/` domain contains `playback.service.ts` and `queue.service.ts`; `user/` domain contains auth and registration; `content/` domain contains scraping and feed storage).
   - Each domain feature is an isolated, independent slice.
   - Slices MUST NOT import concrete files (entities, services, helpers) directly from peer feature slices.
   - Cross-slice entity references use scalar string IDs (`<name>Id: string`) instead of TypeORM relation decorators.

2. **Domain Package (`src/domain/`)**
   - `src/domain/` is a shared type-and-contract package.
   - Contains ONLY pure TypeScript interfaces (`*Data`) and abstract class tokens (`*Contract`).
   - ZERO concrete logic, ZERO TypeORM `@Entity` decorators, ZERO NestJS decorators.
   - Put a type or contract here ONLY if it is consumed by 2 or more feature slices (anti-dumping guardrail).

3. **Architecture Guardrails (Enforced via `src/architecture.spec.ts`)**
   - **Rule 1: Domain Isolation**: `src/domain/` has zero dependencies on feature slices or infrastructure.
   - **Rule 2: Zero Cross-Slice Concrete Imports**: Feature slices only import from `src/domain/` or own directory.
   - **Rule 3: Scalar Foreign IDs**: Entity classes across slices do not import peer entity models.
   - **Rule 4: Domain Anti-Dumping**: Contracts and interfaces in `src/domain/` must be cross-slice (consumed by 2 or more slices).
   - **Rule 5: Zero Bidirectional Slice Coupling**: Slices must have an acyclic dependency graph (no direct circular imports or contract cycles).
   - **Rule 6: Single Entity Table Ownership**: Every database table/entity is owned exclusively by a single domain slice.
   - **Rule 7: Route Domain Ownership**: Controllers only declare routes belonging to their owning domain slice.

4. **Live Audio Streaming Architecture (Icecast + Liquidsoap)**
   - Continuous 128 kbps MP3 stream served to listeners via Icecast mount `/channels/:channelId.mp3` on port 8000.
   - Source generation powered by Liquidsoap sidecar dynamically polling `GET /channels/:channelId/next-track`.
   - **Tail-Resume Radio Illusion**: If a channel was idle for more than 120s, playback resumes at the segment's tail (`startOffsetSeconds = duration - random(10..20)`).
   - **Low Runway Replenishment**: When fewer than 4 segments remain in queue, background `bufferAhead` fills the runway.
   - **Zero 10s Chunking**: Flat-rate stream eliminates HLS manifest slicing and CDN egress multiplication.

5. **Sidecar Placement & Docker Orchestration**
   - Independent background sidecars live at the repository root (e.g. `liquidsoap/`, `reddit-fetcher/`).
   - Container orchestration is centralized exclusively in [`deployment/docker/docker-compose.yml`](../deployment/docker/docker-compose.yml).

---

## File Placement & Naming Guide

| What are you adding? | File Placement | File Naming | Export / Token Name |
| :--- | :--- | :--- | :--- |
| **HTTP Controller** | `src/<feature>/` | `<name>.controller.ts` | `[Name]Controller` |
| **HTTP Request/Response DTO** | `src/<feature>/dto/` | `<name>.dto.ts` | `[Name]Dto` |
| **TypeORM Database Model** | `src/<feature>/entities/` | `<entity>.entity.ts` | `[Name]` (Entity class) |
| **Feature Service** | `src/<feature>/` | `<service>.service.ts` | `[Name]Service` |
| **Feature-Internal Interface/Helper** | `src/<feature>/interfaces/` or `src/<feature>/utils/` | `<name>.interface.ts` or `<name>.util.ts` | `[Name]` |
| **Cross-Slice Service Contract** | `src/domain/contracts/` | `index.ts` | `export abstract class [Feature]Contract` |
| **Cross-Slice Domain Payload** | `src/domain/types/` | `<concept>.types.ts` | `export interface [Concept]Data` |
| **Root-Level Sidecar Service** | `<service>/` | `Dockerfile`, `<service>.liq`, etc. | Containerized daemon |
| **Docker Compose Services** | `deployment/docker/` | `docker-compose.yml` | `[Service]` container |

---

## Decision Guide: Where Does This Code Go?

1. **Is it HTTP-facing (Routing / Guards / Request DTOs)?**
   → Put in `src/<feature>/` or `src/<feature>/dto/`.

2. **Is it Database / Persistence?**
   → Put in `src/<feature>/entities/`.

3. **Is it feature business logic?**
   → Put in `src/<feature>/`.

4. **Is it a contract or payload shared by 2+ feature slices?**
   → Put in `src/domain/contracts/` (`*Contract`) or `src/domain/types/` (`*Data`).

5. **Is it reusable technical infrastructure (Storage, DB connection, Logger)?**
   → Put in `src/infrastructure/<service>/`.

6. **Is it a dedicated daemon/runtime sidecar?**
   → Put in `<sidecar>/` at root, wire into `deployment/docker/docker-compose.yml`.
