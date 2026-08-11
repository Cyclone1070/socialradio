import { Writable } from 'stream';
import { Test } from '@nestjs/testing';
import { Controller, Get, INestApplication } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { LoggingModule } from './logging.module';
import request from 'supertest';

@Controller()
class PingController {
  @Get('ping')
  ping(): { pong: boolean } {
    return { pong: true };
  }
}

/**
 * The production request-logging chain: LoggingModule (AppModule's import)
 * plus `app.useLogger(app.get(Logger))` in main.ts — the module under test
 * IS the production module, so the wiring is pinned by a test, not by faith.
 */
describe('HTTP request logging (pino-http)', () => {
  let app: INestApplication;
  const lines: string[] = [];

  const stream = new Writable({
    write(chunk: Buffer, _enc: unknown, cb: () => void): void {
      lines.push(chunk.toString());
      cb();
    },
  });

  beforeEach(async () => {
    lines.length = 0;

    const moduleRef = await Test.createTestingModule({
      imports: [LoggingModule.forRoot({ stream, level: 'info' })],
      controllers: [PingController],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useLogger(app.get(Logger));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('emits ONE JSON request log per request, with req, res and statusCode', async () => {
    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .get('/ping')
      .expect(200);

    const requestLine = lines
      .map((l) => l.trim())
      .find((l) => l.includes('"req"') && l.includes('"res"'));
    expect(requestLine).toBeDefined();

    const parsed = JSON.parse(requestLine ?? '{}') as {
      req: { method: string; url: string };
      res: { statusCode: number };
    };
    expect(parsed.req).toMatchObject({ method: 'GET', url: '/ping' });
    expect(parsed.res).toMatchObject({ statusCode: 200 });
  });
});
