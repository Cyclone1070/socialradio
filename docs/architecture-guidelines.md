# Architecture Guidelines

This document provides decision rules for file placement and code organization when adding new features, modules, or files to the codebase.

---

## Core Rules

1. **Feature Slices (`src/<feature>/`)**
   - Modules are organized strictly by **Domain**, not by technical or functional concern (e.g., `user/` domain instead of `auth/` function, `content/` domain instead of `scraper/` function).
   - Each domain feature is an isolated, independent slice.
   - Slices MUST NOT import concrete files (entities, services, helpers) directly from other feature slices.
   - Cross-slice references use scalar string IDs (`<name>Id: string`) instead of ORM entity relationships.

2. **Domain Package (`src/domain/`)**
   - `src/domain/` is a shared type-and-contract package.
   - Contains ONLY pure TypeScript interfaces (`*Data`) and abstract class tokens (`*Contract`).
   - ZERO concrete logic, ZERO TypeORM `@Entity` decorators, ZERO NestJS decorators.
   - Put a type or contract here ONLY if it is consumed by 2 or more feature slices.

---

## File Placement & Naming Guide

When adding code, place files according to this decision guide:

| What are you adding? | File Placement | File Naming | Export / Token Name |
| :--- | :--- | :--- | :--- |
| **HTTP Controller** | `src/<feature>/` | `<name>.controller.ts` | `[Name]Controller` |
| **HTTP Request/Response DTO** | `src/<feature>/dto/` | `<name>.dto.ts` | `[Name]Dto` |
| **TypeORM Database Model** | `src/<feature>/entities/` | `<entity>.entity.ts` | `[Name]` (Entity class) |
| **Feature Service** | `src/<feature>/` | `<service>.service.ts` | `[Name]Service` |
| **Feature-Internal Interface/Helper** | `src/<feature>/interfaces/` or `src/<feature>/utils/` | `<name>.interface.ts` or `<name>.util.ts` | `[Name]` |
| **Cross-Slice Service Contract** | `src/domain/contracts/` | `index.ts` | `export abstract class [Feature]Contract` |
| **Cross-Slice Domain Payload** | `src/domain/types/` | `<concept>.types.ts` | `export interface [Concept]Data` |

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
