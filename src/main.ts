import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

process.on('unhandledRejection', (reason) => {
  console.warn('Unhandled Promise Rejection (Prevented Crash):', reason);
});

process.on('uncaughtException', (error) => {
  console.warn('Uncaught Exception (Prevented Crash):', error);
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap().catch((err) => console.error(err));
