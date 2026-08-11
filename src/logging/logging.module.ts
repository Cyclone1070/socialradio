import { DynamicModule, Module } from '@nestjs/common';
import { LoggerModule, PinoLogger } from 'nestjs-pino';
import type { DestinationStream } from 'pino';

export interface LoggingOptions {
  /** Test seam: capture pino output instead of stdout. */
  stream?: DestinationStream;
  /** Overrides LOG_LEVEL for a specific app (used by the logging specs). */
  level?: string;
}

/**
 * Service-side logger. Standalone by design (no DI churn in unit specs):
 * once LoggingModule is initialized the module-level pino is reused, so
 * every service shares the configured level + destination.
 */
export function createServiceLogger(context: string): PinoLogger {
  const logger = new PinoLogger({
    pinoHttp: { level: process.env.LOG_LEVEL ?? 'info' },
  });
  logger.setContext(context);
  return logger;
}

/**
 * The app's one logging entry point. AppModule imports LoggingModule.forRoot()
 * — no other module configures pino. Services emit via PinoLogger, which,
 * once this module is initialized, reuses its pino instance (level + stream).
 */
@Module({})
export class LoggingModule {
  static forRoot(opts: LoggingOptions = {}): DynamicModule {
    return LoggerModule.forRoot({
      pinoHttp: {
        level: opts.level ?? process.env.LOG_LEVEL ?? 'info',
        ...(opts.stream ? { stream: opts.stream } : {}),
      },
    });
  }
}
