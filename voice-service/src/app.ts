import express from 'express';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { z } from 'zod';
import { NothingToSpeakError, Script, Track } from './types';

const scriptSchema = z.object({
  postId: z.string().min(1),
  turns: z.array(z.object({ speaker: z.string().min(1), text: z.string() })),
});

/**
 * HTTP surface of the voice service: one endpoint, the script in and the audio
 * out. The length travels in a header because the caller stores it as the
 * segment's length, and it is measured here, where the audio is produced.
 */
export function createApp(
  synthesize: (script: Script) => Promise<Track>,
  logger: pino.Logger = pino(),
): express.Express {
  const app = express();
  app.use(pinoHttp({ logger }));
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.post('/synthesize', (req, res) => {
    const parsed = scriptSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'body is not a script' });
      return;
    }

    synthesize(parsed.data)
      .then((track) => {
        res.writeHead(200, {
          'content-type': 'audio/mpeg',
          'content-length': track.audio.length,
          'x-duration-seconds': String(track.seconds),
        });
        res.end(track.audio);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        if (err instanceof NothingToSpeakError) {
          res.status(400).json({ error: message });
          return;
        }
        // The engine failed, which is this service's problem, not the caller's.
        logger.error({ err: message }, 'synthesis failed');
        res.status(500).json({ error: message });
      });
  });

  return app;
}
