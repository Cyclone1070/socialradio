/**
 * Tier 1 mock for the voice service.
 *
 * It stands exactly where the real service stands - behind VOICE_SERVICE_URL - so
 * the app's own HTTP client, its duration handling and its storage write all stay
 * real, while the audio itself is pregenerated and no turn reaches the speech
 * engine. The length it reports was measured by ffprobe when the audio was
 * recorded, so the docker suite can still hold the stored segment to the audio.
 */
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PORT = Number(process.env.STUB_PORT ?? 4012);
const DIR = process.env.FIXTURES_DIR ?? '/fixtures';

const track = readFileSync(join(DIR, 'track.mp3'));
const meta = JSON.parse(readFileSync(join(DIR, 'track.json'), 'utf8')) as {
  seconds: number;
};

/** What a voice could say: the same rule the real service applies. */
const speakable = (
  turns: { text?: unknown }[] | undefined,
): boolean =>
  Array.isArray(turns) &&
  turns.some(
    (turn) =>
      typeof turn?.text === 'string' &&
      turn.text.replace(/\[.*?\]|\(.*?\)/g, '').trim().length > 0,
  );

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
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
};

createServer(async (req, res) => {
  const url = req.url ?? '';

  if (req.method === 'GET' && url.startsWith('/health')) {
    return json(res, 200, { status: 'ok' });
  }

  if (req.method !== 'POST' || !url.startsWith('/synthesize')) {
    return json(res, 404, { error: `no mock route for ${url}` });
  }

  const body = (await readBody(req)) as {
    postId?: string;
    turns?: { text?: unknown }[];
  };

  if (!body.postId || !speakable(body.turns)) {
    return json(res, 400, { error: 'script has no turns to speak' });
  }

  res.writeHead(200, {
    'content-type': 'audio/mpeg',
    'content-length': track.length,
    'x-duration-seconds': String(meta.seconds),
  });
  res.end(track);
}).listen(PORT, '0.0.0.0', () => {
  process.stdout.write(`voice mock listening on ${PORT} with ${track.length} bytes\n`);
});
