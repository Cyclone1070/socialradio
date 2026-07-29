import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthcheckController {
  @Get('healthcheck')
  getHealthcheck(): { status: string; timestamp: string } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
