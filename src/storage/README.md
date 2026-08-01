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
  - `channels/{channelId}/chunks/{segmentId}_{index}.mp3` — HLS chunks (10s slices), served by the channel slice with immutable cache headers
  - `assets/cache/tts-post-{postId}.mp3` — generated voice tracks
- Everything is written through this interface: generated TTS, chunked audio, and (for reads) chunk serving.
- Backing store is swappable by changing one binding — slices depend on the interface, never the implementation.
