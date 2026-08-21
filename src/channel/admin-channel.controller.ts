import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../infrastructure/auth';
import { QueueService } from './queue.service';

@Controller('admin/channels')
export class AdminChannelController {
  constructor(private readonly queueService: QueueService) {}

  @Get(':id/topics')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  async getTopics(@Param('id') id: string): Promise<unknown> {
    return await this.queueService.findPendingTopicSegment(id);
  }
}
