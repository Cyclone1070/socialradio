import { cleanSpokenText, voiceForSpeaker, DEFAULT_VOICE } from './voices';

describe('voice casting', () => {
  it('gives each persona its own Neural voice', () => {
    expect(voiceForSpeaker('Dave')).toBe('en-US-GuyNeural');
    expect(voiceForSpeaker('Sarah')).toBe('en-US-JennyNeural');
    expect(voiceForSpeaker('Caller')).toBe('en-AU-NatashaNeural');
  });

  it('falls back to the host voice for a speaker nobody cast', () => {
    expect(voiceForSpeaker('UnknownSpeaker')).toBe(DEFAULT_VOICE);
  });
});

describe('cleanSpokenText', () => {
  it('strips the stage directions a voice would otherwise read out loud', () => {
    expect(cleanSpokenText('[laughs] That was wild (pauses) mate!')).toBe(
      'That was wild mate!',
    );
  });
});
