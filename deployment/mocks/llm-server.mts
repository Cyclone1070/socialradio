/**
 * Tier 1 mock for the script-generation provider.
 *
 * It stands exactly where the real provider stands - behind LLM_BASE_URL - so
 * everything above it stays real: our LlmService, the AI SDK, the stream
 * parsing, and the app's own script parser.
 *
 * It answers the two shapes the app actually asks for, picked from the system
 * prompt: a Stage 1 outline that must contain STEP 1..4 markers, and a Stage 2
 * dialogue that must parse into speaker turns. Responses stream as deltas
 * because that is what the app consumes.
 */
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PORT = Number(process.env.STUB_PORT ?? 4010);
const MODEL = process.env.LLM_MODEL ?? 'mock-model';
const RESPONSES = join(import.meta.dirname, 'responses');

const outline = readFileSync(join(RESPONSES, 'stage1-outline.md'), 'utf8').trim();
const dialogue = readFileSync(join(RESPONSES, 'stage2-dialogue.txt'), 'utf8').trim();

const isStageOne = (body: { messages?: { role: string; content: string }[] }): boolean => {
  const system = body.messages?.find((message) => message.role === 'system')?.content ?? '';
  return /executive producer/i.test(system);
};

/**
 * The app tells the model what came before, and how to open. A real model acts on
 * that, so the stub does too: the line it opens with is derived from the
 * instruction it was given, which is what makes continuity observable end to end.
 */
const openingLineFor = (body: { messages?: { role: string; content: string }[] }): string => {
  const user = body.messages?.find((message) => message.role === 'user')?.content ?? '';
  const how = /=== HOW TO OPEN[^\n]*===\n([^\n]+)/.exec(user)?.[1] ?? '';
  if (!how) return '';
  const thread = /Here is the outline it followed:\s*([^\n]+)/.exec(
    user.replace(/\n/g, ' '),
  )?.[1];
  if (thread) return `Dave: Picking up where we left off - ${thread.trim()}`;
  if (/first conversation/.test(how)) {
    return 'Dave: Hello and welcome to the show, first-time callers especially.';
  }
  if (/Welcome them back/.test(how)) return "Dave: Welcome back - here's where we were.";
  return '';
};

/**
 * Obedience is a mode, not a fact. A real model sometimes answers with the wrong
 * opening, and the app is supposed to refuse it - so the stub can be told to
 * misbehave over HTTP, which is the only channel the suites have.
 */
let contradict = process.env.LLM_STUB_CONTRADICT === '1';
/**
 * How long each answer takes. A run that is slow on purpose is the only way to hold
 * a station mid-generation while a second instance asks for it, without racing.
 */
let delayMs = Number(process.env.LLM_STUB_DELAY_MS ?? 0);
let completions = 0;

const readBody = (req: IncomingMessage): Promise<Record<string, unknown>> =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        resolve({});
      }
    });
  });

const json = (res: ServerResponse, status: number, body: unknown): void => {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
};

createServer(async (req, res) => {
  const url = req.url ?? '';

  if (req.method === 'GET' && url.startsWith('/health')) {
    return json(res, 200, { status: 'ok' });
  }

  if (req.method === 'GET' && url.startsWith('/models')) {
    return json(res, 200, { object: 'list', data: [{ id: MODEL, object: 'model', owned_by: 'mock' }] });
  }

  if (url === '/__control') {
    if (req.method === 'GET') {
      return json(res, 200, { contradict, delayMs, completions });
    }
    if (req.method === 'POST') {
      const control = (await readBody(req)) as { mode?: string; delayMs?: number };
      if (control.mode !== undefined) contradict = control.mode === 'contradict';
      if (typeof control.delayMs === 'number') delayMs = control.delayMs;
      return json(res, 200, { contradict, delayMs, completions });
    }
  }

  if (req.method !== 'POST' || !url.startsWith('/chat/completions')) {
    return json(res, 404, { error: { message: `no mock route for ${url}` } });
  }

  const body = (await readBody(req)) as {
    model?: string;
    stream?: boolean;
    messages?: { role: string; content: string }[];
  };

  // A retired model must fail loudly, exactly like the real provider, so the
  // contract probe and the app both see the same behaviour.
  if (body.model !== MODEL) {
    return json(res, 400, { error: { type: 'server_error', message: 'Model is unavailable.' } });
  }

  // In contradict mode the model answers every conversation with a show-opening
  // greeting, whatever it was asked for. Nobody has just arrived, so the app must
  // refuse it rather than air it.
  completions += 1;
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));

  const opening = isStageOne(body)
    ? ''
    : contradict
      ? 'Dave: Hello and welcome to the show, first-time callers especially.'
      : openingLineFor(body);
  const content = isStageOne(body) ? outline : [opening, dialogue].filter(Boolean).join('\n');

  if (!body.stream) {
    return json(res, 200, {
      id: 'mock-completion',
      object: 'chat.completion',
      model: body.model,
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  }

  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  for (const line of content.split('\n')) {
    if (!line) continue;
    res.write(
      `data: ${JSON.stringify({
        id: 'mock-chunk',
        object: 'chat.completion.chunk',
        model: body.model,
        choices: [{ index: 0, delta: { content: `${line}\n` } }],
      })}\n\n`,
    );
  }
  res.write(
    `data: ${JSON.stringify({
      id: 'mock-chunk',
      object: 'chat.completion.chunk',
      model: body.model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    })}\n\n`,
  );
  res.write('data: [DONE]\n\n');
  res.end();
}).listen(PORT, '0.0.0.0', () => {
  process.stdout.write(`llm mock listening on ${PORT} as ${MODEL}\n`);
});
