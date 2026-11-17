import { ScriptData } from '../script/types/script.types';
import { TalkData } from './types/audio.types';

/**
 * Turn a script into a stored audio segment. The words come from script; the
 * voice, the format and the measured length are this slice's business.
 */
export abstract class VoiceContract {
  abstract synthesizeScript(
    script: ScriptData,
    outputPath: string,
  ): Promise<TalkData>;
}
