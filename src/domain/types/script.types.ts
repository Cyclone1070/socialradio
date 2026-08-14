export interface Speaker {
  name: string;
  role: string;
  voiceId: string;
}

export interface ScriptTurn {
  speaker: string;
  text: string;
}

export interface ScriptData {
  postId: string;
  turns: ScriptTurn[];
}

export const DEFAULT_SPEAKERS: Record<string, Speaker> = {
  Dave: { name: 'Dave', role: 'Pragmatist Host', voiceId: 'en-US-Studio-O' },
  Sarah: { name: 'Sarah', role: 'Empathetic Host', voiceId: 'en-US-Studio-E' },
  Mike: { name: 'Mike', role: 'Skeptic Host', voiceId: 'en-US-Studio-J' },
  Jenny: { name: 'Jenny', role: 'Wildcard Host', voiceId: 'en-US-Studio-F' },
  Caller: { name: 'Caller', role: 'Guest Caller', voiceId: 'en-US-Studio-Q' },
};
