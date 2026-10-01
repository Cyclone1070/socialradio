import pino from 'pino';
import { createApp } from './app';
import { synthesizeTrack } from './synthesizer';

const port = Number(process.env.PORT ?? 3002);

// LOG_LEVEL controls verbosity; LOG_PRETTY=1 switches to human-readable output
// for local development (JSON stays the default for containers).
const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(process.env.LOG_PRETTY === '1'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
});

createApp((script) => synthesizeTrack(script.turns), logger).listen(
  port,
  () => {
    logger.info({ port }, 'voice-service listening');
  },
);
