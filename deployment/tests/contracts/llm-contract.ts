/**
 * Tier 2 contract probes for the script-generation provider.
 *
 * Drives the app's own LlmService and its own script parser, so what gets
 * verified is exactly what the app assumes. No database, no channel, no
 * pipeline, and only toy prompts — never prod-like data.
 */
import { ConfigService } from '@nestjs/config';
import { LlmService } from '../../../src/script/llm.service';
import { ScriptService } from '../../../src/script/script.service';

// Credentials arrive as environment variables: run-contract-tests.sh sources the
// repo's .env, and CI passes them from its secrets. Reading .env here as well would
// mean importing dotenv, which this package does not depend on.

let failures = 0;
let passes = 0;
const ok = (msg: string) => { passes++; console.log(`  OK   - ${msg}`); };
const bad = (msg: string) => { failures++; console.log(`  FAIL - ${msg}`); };
const skip = (msg: string) => console.log(`  SKIP - ${msg}`);

/** Provider pools rate-limit shared free models: availability, not a contract break. */
const isUnavailable = (message: string) => /\b(429|503)\b|rate.?limit/i.test(message);

const service = () => new LlmService(new ConfigService(process.env as Record<string, string>));
const PROMPT =
  'Write six short lines of radio dialogue alternating between Host and Caller, ' +
  'one line each, formatted exactly as "Host: ..." and "Caller: ...".';

async function main(): Promise<void> {
  console.log(`=== Contract: script generation via LlmService (${process.env.LLM_MODEL}) ===`);

  // No endpoint or key means there is no provider to hold to anything. That is a
  // missing credential, not a broken contract, so it skips rather than fails -
  // the same distinction the availability classifier below makes.
  if (!process.env.LLM_BASE_URL || !process.env.LLM_API_KEY) {
    skip('LLM_BASE_URL / LLM_API_KEY are not set - nothing to probe');
    process.exit(0);
  }

  let text = '';
  try {
    text = await service().generateText('You write terse radio dialogue.', PROMPT);
    if (text.trim().length > 0) ok('the app\'s LlmService returns non-empty text');
    else bad('generateText returned empty text');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isUnavailable(message)) skip(`provider unavailable — ${message.slice(0, 90)}`);
    else bad(`generateText threw: ${message.slice(0, 160)}`);
  }

  if (text.trim().length > 0) {
    // The app's real parser over the provider's real answer: the assumption
    // that actually matters is "this model produces something we can parse".
    const parser = Object.create(ScriptService.prototype) as ScriptService;
    try {
      const script = parser.parseScriptText('probe', text);
      const speakers = new Set(script.turns.map((turn) => turn.speaker));
      if (script.turns.length >= 2 && speakers.size >= 2) {
        ok(`the answer parses into a script (${script.turns.length} turns, ${speakers.size} speakers)`);
      } else {
        bad(`parsed but too thin: ${JSON.stringify(text.slice(0, 160))}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      bad(`the app's parser rejected the answer: ${message} :: ${JSON.stringify(text.slice(0, 160))}`);
    }
  }

  const originalModel = process.env.LLM_MODEL;
  process.env.LLM_MODEL = `${originalModel}-does-not-exist`;
  try {
    const deadText = await service().generateText('You write terse radio dialogue.', PROMPT);
    bad(
      deadText.trim().length === 0
        ? 'a retired model produced a silent empty script instead of failing loudly'
        : 'a retired model answered instead of failing loudly',
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isUnavailable(message)) skip(`provider unavailable — ${message.slice(0, 90)}`);
    else ok(`a retired model fails loudly (${message.slice(0, 70)})`);
  } finally {
    process.env.LLM_MODEL = originalModel;
  }

  console.log(`\ncontract probes: ${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
