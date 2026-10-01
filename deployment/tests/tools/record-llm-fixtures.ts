/**
 * Records what the real provider answers, so the Tier 1 mock replays a real
 * response instead of a hand-written idea of one.
 *
 * The mock routes by system prompt, so this drives the app's own two prompts and
 * the app's own parser, and refuses to write anything the app could not use: an
 * outline without STEP 1..4 markers, or a dialogue that does not parse into
 * speaker turns, is not a fixture worth replaying.
 *
 * One billable call per stage, which is the budget the probes keep. It rewrites
 * committed files, so it is never run by CI - a human re-records deliberately, with
 * credentials in the environment the same way the probes get them:
 *   set -a; . ./.env; set +a
 *   npx ts-node --transpile-only deployment/tests/tools/record-llm-fixtures.ts
 *
 * Writes deployment/mocks/responses/{stage1-outline.md,stage2-dialogue.txt} and a
 * fingerprint line for the docker suite to look for in the script the app stored.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { LlmService } from '../../../src/script/llm.service';
import { ScriptService } from '../../../src/script/script.service';
import {
  STAGE1_OUTLINE_SYSTEM_PROMPT,
  STAGE2_DIALOGUE_SYSTEM_PROMPT,
} from '../../../src/script/script.service';

const RESPONSES = join(__dirname, '..', '..', 'mocks', 'responses');
const FIXTURES = join(__dirname, '..', 'fixtures');

/** Toy material: a small, invented topic, never prod-like content. */
const SOURCE_MATERIAL = [
  'Title: My landlord just stopped replying',
  'Body: The ceiling in my flat started leaking three weeks ago. I told the landlord the same day.',
  'Body: He replied once, said he would send someone, and has ignored every message since.',
  'Top comment (412 points): Put everything in writing and send it recorded delivery.',
  'Top comment (208 points): Your council can force the repair, it is called an improvement notice.',
].join('\n');

const service = (): LlmService =>
  new LlmService(new ConfigService(process.env as Record<string, string>));

const stripFences = (text: string): string =>
  text
    .replace(/^\s*```[a-z]*\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

/** Speaker lines only: what a chatty answer needs to become parseable. */
const speakerLines = (text: string): string =>
  text
    .split('\n')
    .filter((line) => /^[A-Za-z][A-Za-z .'-]{0,20}:\s*\S/.test(line.trim()))
    .join('\n')
    .trim();

const parse = (text: string): { turns: { speaker: string; text: string }[] } =>
  (
    Object.create(ScriptService.prototype) as ScriptService
  ).parseScriptText('fixture-post', text);

async function main(): Promise<void> {
  if (!process.env.LLM_BASE_URL || !process.env.LLM_API_KEY) {
    process.stdout.write('LLM_BASE_URL / LLM_API_KEY are not set - nothing to record\n');
    return;
  }
  process.stdout.write(`recording from ${process.env.LLM_BASE_URL} as ${process.env.LLM_MODEL}\n`);

  let outline = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    outline = stripFences(
      await service().generateText(
        STAGE1_OUTLINE_SYSTEM_PROMPT,
        `Here is the topic for the call-in segment:\n\n${SOURCE_MATERIAL}\nPlease generate the Stage 1 Call-In Segment Outline now.`,
      ),
    );
    const missing = [1, 2, 3, 4].filter(
      (step) => !new RegExp(`STEP\\s*${step}\\b`, 'i').test(outline),
    );
    if (missing.length === 0) break;
    process.stdout.write(`attempt ${attempt}: outline is missing STEP ${missing.join(', ')} - retrying\n`);
    outline = '';
  }
  if (!outline) throw new Error('the provider never returned an outline with STEP 1..4 markers');

  const raw = stripFences(
    await service().generateText(
      STAGE2_DIALOGUE_SYSTEM_PROMPT,
      `=== STAGE 1 SHOW OUTLINE (Follow this Markdown roadmap strictly) ===\n${outline}\n\n=== ORIGINAL SOURCE MATERIAL (Use for rich dialogue details & quotes) ===\n${SOURCE_MATERIAL}\n\nPlease write the complete spoken dialogue script now following the Stage 1 outline.`,
    ),
  );

  let dialogue = raw;
  let turns = parse(raw).turns;
  if (turns.length < 3) {
    // The app's parser rejects an answer wrapped in prose, so keep only the
    // speaker lines - and say so, rather than pretending the model was tidier.
    dialogue = speakerLines(raw);
    turns = parse(dialogue).turns;
    process.stdout.write(
      `kept ${turns.length} speaker lines out of a ${raw.length}-character answer\n`,
    );
  }
  const speakers = new Set(turns.map((turn) => turn.speaker));
  if (turns.length < 3 || speakers.size < 2) {
    throw new Error(
      `recorded dialogue is unusable: ${turns.length} turns, ${speakers.size} speakers`,
    );
  }

  // The fingerprint has to survive into a JSON column unescaped, so it must not
  // contain quotes or backslashes, and it must be long enough to be distinctive.
  const fingerprint = [...turns]
    .map((turn) => turn.text.trim())
    .filter((text) => text.length > 30 && !/["\\]/.test(text))
    .sort((a, b) => b.length - a.length)[0];
  if (!fingerprint) {
    throw new Error('no turn is long enough and clean enough to fingerprint');
  }

  mkdirSync(RESPONSES, { recursive: true });
  mkdirSync(FIXTURES, { recursive: true });
  writeFileSync(join(RESPONSES, 'stage1-outline.md'), `${outline}\n`);
  writeFileSync(join(RESPONSES, 'stage2-dialogue.txt'), `${dialogue}\n`);
  writeFileSync(join(FIXTURES, 'llm-dialogue-fingerprint.txt'), `${fingerprint}\n`);

  process.stdout.write(
    `wrote outline (${outline.length} chars), dialogue (${dialogue.length} chars, ${turns.length} turns, ${speakers.size} speakers)\n`,
  );
  process.stdout.write(`fingerprint: ${fingerprint}\n`);
}

void main();
