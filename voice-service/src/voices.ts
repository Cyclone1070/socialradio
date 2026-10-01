/**
 * Who sounds like what, and what the voice should not read out loud.
 *
 * This lives here rather than in the app because it is a property of the speech
 * engine: the app sends speaker names and lines, and casting them is this
 * service's job.
 */
export const SPEAKER_VOICE_MAP: Record<string, string> = {
  Dave: 'en-US-GuyNeural',
  Sarah: 'en-US-JennyNeural',
  Caller: 'en-AU-NatashaNeural',
};

export const DEFAULT_VOICE = 'en-US-GuyNeural';

export const voiceForSpeaker = (speaker: string): string =>
  SPEAKER_VOICE_MAP[speaker] || DEFAULT_VOICE;

/** Stage directions are for a reader, not a listener. */
export const cleanSpokenText = (text: string): string =>
  text
    .replace(/\[.*?\]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
