import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../user/roles.guard';
import { Roles } from '../user/roles.decorator';
import { SegmentService } from './segment.service';

@Controller('admin/channels')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('admin')
export class AdminSegmentController {
  constructor(private readonly segmentService: SegmentService) {}

  @Get(':id/topics')
  async getTopics(@Param('id') id: string): Promise<unknown> {
    return await this.segmentService.findPendingTopicSegment(id);
  }
}
