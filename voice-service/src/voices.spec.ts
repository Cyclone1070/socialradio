import { cleanSpokenText, voiceForSpeaker, DEFAULT_VOICE } from './voices';

describe('voice casting', () => {
  it('gives each persona its own Neural voice', () => {
    expect(voiceForSpeaker('Dave')).toBe('en-US-GuyNeural');
    expect(voiceForSpeaker('Sarah')).toBe('en-US-JennyNeural');
    expect(voiceForSpeaker('Caller')).toBe('en-AU-NatashaNeural');
    // The station's own voice: someone who was never in the room, so a break
    // announcement does not sound like the host who just said goodbye.
    expect(voiceForSpeaker('Station')).toBe('en-GB-SoniaNeural');
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
