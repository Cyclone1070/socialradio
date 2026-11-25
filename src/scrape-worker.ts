import { NestFactory } from '@nestjs/core';
import { ScrapeWorkerModule } from './content/scrape-worker.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(ScrapeWorkerModule);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void app
        .close()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    });
  }
}

bootstrap().catch((err: unknown) => {
  console.error('scrape worker bootstrap failed', err);
  process.exit(1);
});
