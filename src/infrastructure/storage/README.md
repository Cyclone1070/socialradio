# Storage — Object Storage Abstraction

A single storage interface that everything else depends on — the rest of the app never touches S3/MinIO APIs directly.

## Public API

No HTTP routes. `StorageService` interface (injected as `'StorageService'` token):

| Method | Behaviour |
|---|---|
| `write({ key, content, contentType?, cacheControl? })` | Store a file (Buffer or string). |
| `read(key)` | Fetch a file as Buffer. |
| `exists(key)` | Whether a key exists. |
| `delete(key)` | Remove a file. |
| `getPublicUrl(key)` | Publicly fetchable URL for a key. |

Implementation: `S3StorageService` (MinIO, S3-compatible).

## Behaviour

- **Key scheme is the contract** — paths are meaningful:
  - `topic-audios/talk-{uuid}.mp3` — generated voice talk segments
  - `media/music/*.mp3` — music tracks
  - `media/ads/*.mp3` — ad tracks
  - `media/jingles/*.mp3` — station jingles
- Everything is written through this interface: generated TTS and media storage.
- Backing store is swappable by changing one binding — slices depend on the interface, never the implementation.
