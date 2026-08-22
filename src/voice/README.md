# Voice — Text-to-Speech Audio Synthesis

Synthesizes multi-speaker talk radio dialogue into broadcast MP3 voice tracks using Google Cloud Text-to-Speech and saves them to object storage.

## Public API

No HTTP routes. Implements `VoiceContract` (`synthesizeScript(script, outputPath): Promise<TalkData>`). Injected by `QueueService`.

## Behaviour

- **Speech Synthesis**: Sends dialogue text to Google Cloud Text-to-Speech API (`en-US-Studio-O`, MP3 encoding).
- **Storage Output**: Writes raw audio buffer directly to `StorageService` at target key (e.g. `audio/talk-{uuid}.mp3`).
- **Duration Calculation**: Computes audio duration from MP3 buffer length using 128kbps CBR formula (16,000 bytes/sec).
- **Return Contract**: Returns [`TalkData`](../domain/types/audio.types.ts) (`{ filePath, durationSeconds, postIds }`).
