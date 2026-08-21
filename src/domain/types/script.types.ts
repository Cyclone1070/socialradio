export interface ScriptTurn {
  speaker: string;
  text: string;
}

export interface ScriptData {
  postId: string;
  turns: ScriptTurn[];
}
