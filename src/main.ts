import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { Logger, PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';

// Standalone logger for anything that happens before the Nest app exists
// (process-level fatal handlers, bootstrap failures). Once AppModule is up,
// services reuse the module's pino instance (level + destination).
const bootLogger = new PinoLogger({});
bootLogger.setContext('Bootstrap');

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

process.on('unhandledRejection', (reason) => {
  bootLogger.error({ err: toError(reason) }, 'Unhandled Promise Rejection');
});

process.on('uncaughtException', (error) => {
  bootLogger.error({ err: toError(error) }, 'Uncaught Exception');
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Route Nest's own logs through pino (JSON on stdout); pino-http request
  // logging is attached by LoggingModule itself.
  app.useLogger(app.get(Logger));
  app.useGlobalPipes(new ValidationPipe());

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap().catch((err) => {
  bootLogger.fatal({ err: toError(err) }, 'Bootstrap failed');
});
