# Voice — Text-to-Speech Audio Synthesis

Synthesizes multi-speaker talk radio dialogue into broadcast MP3 voice tracks using Google Cloud Text-to-Speech (Neural2 Tier) and saves them to object storage.

## Public API

No HTTP routes. Implements `VoiceContract` (`synthesizeScript(script, outputPath): Promise<TalkData>`). Injected by `QueueService`.

## Persona Voice Mappings (100% Free-Tier Neural2)

| Persona | Role | Voice Model | Characteristics |
|---|---|---|---|
| **Dave** | Lead Anchor | `en-US-Neural2-J` | Charismatic, conversational male |
| **Sarah** | Co-Host | `en-US-Neural2-F` | Warm, expressive female |
| **Caller** | Guest OP | `en-US-Neural2-I` | Distinct conversational caller |
| *Fallback* | Default | `en-US-Neural2-J` | Fallback voice |

## Synthesis Pipeline

1. **Defensive Sanitization**: Strips accidental bracket/parenthesis directions (`\[.*?\]`, `\(.*?\)`) before sending to TTS.
2. **Turn-by-Turn Synthesis**: Synthesizes each `ScriptTurn` with the persona's designated voice model via Google Cloud TTS REST API.
3. **Audio Stitching**: Concatenates individual turn MP3 buffers into a single audio file.
4. **Storage Output**: Writes raw audio buffer directly to `StorageService` at target key (e.g. `talk/{uuid}.mp3`).
5. **Duration Calculation**: Computes audio duration from MP3 buffer length using 128kbps CBR formula (16,000 bytes/sec).
6. **Return Contract**: Returns [`TalkData`](../domain/types/audio.types.ts) (`{ filePath, durationSeconds, postIds }`).
