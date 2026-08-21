# Domain — Shared Contracts & Data Types

Cross-slice contracts and shared data models that define communication boundaries between feature slices.

## Principles & Guardrails

- **Contracts over concrete implementations**: Slices depend strictly on abstract class contracts in `src/domain/contracts/` (`ContentContract`, `ScriptContract`, `VoiceContract`, `MediaContract`), never importing concrete services or models from peer slices.
- **Zero ORM or NestJS Decorators**: Domain files are pure TypeScript interfaces and abstract contract definitions.
- **Strict Anti-Dumping**: Every symbol exported from `src/domain/` must be consumed across 2+ feature slices or form the signature of a domain contract.
- **Segment Taxonomy**: **Talk / Music / Ad / Jingle** — the four segment types a channel queue can hold.
