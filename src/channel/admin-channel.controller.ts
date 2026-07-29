import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { QueueGeneratorService } from './queue-generator.service';

@Controller('admin/channels')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('admin')
export class AdminChannelController {
  constructor(private readonly queueGeneratorService: QueueGeneratorService) {}

  @Get(':id/topics')
  async getTopics(@Param('id') id: string) {
    return this.queueGeneratorService.findPendingTopicSegment(id);
  }
}
