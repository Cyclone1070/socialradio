# Storage — Object Storage Abstraction

A single storage service abstraction for managing audio and media files in S3-compatible object stores (MinIO/S3).

## Public API

`StorageService` interface and provider:

| Method | Behaviour |
|---|---|
| `write(key, content, params?)` | Store a file (Buffer or string). |
| `read(key)` | Fetch a file as Buffer. |
| `exists(key)` | Check whether a key exists. |
| `delete(key)` | Remove a file. |
| `getPublicUrl(key)` | Publicly fetchable URL for a key. |

## Storage Key Convention

- **`audio/talk-{uuid}.mp3`**: Generated talk voice tracks (synthesized via TTS)
- **`media/music/*.mp3`**: Station music tracks
- **`media/ads/*.mp3`**: Sponsor ad tracks
- **`media/jingles/*.mp3`**: Station identity jingles
