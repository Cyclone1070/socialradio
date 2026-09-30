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

  const content = isStageOne(body) ? outline : dialogue;

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
