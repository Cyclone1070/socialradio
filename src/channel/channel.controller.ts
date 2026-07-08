import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Response, Request } from 'express';
import { ChannelService } from './channel.service';
import { ChannelBroadcasterService } from './channel-broadcaster.service';
import { ConfigureChannelDto } from './dto/configure-channel.dto';
import { ChannelResponseDto } from './dto/channel-response.dto';

@Controller('channels')
export class ChannelController {
  constructor(
    private readonly channelService: ChannelService,
    private readonly broadcasterService: ChannelBroadcasterService,
  ) {}

  @Get()
  @UseGuards(AuthGuard('jwt'))
  async getUserChannels(
    @Req() req: Request & { user: { id: string } },
  ): Promise<ChannelResponseDto[]> {
    return this.channelService.getUserChannels(req.user.id);
  }

  @Post()
  @UseGuards(AuthGuard('jwt'))
  async configureChannel(
    @Body() dto: ConfigureChannelDto,
    @Req() req: Request & { user: { id: string } },
  ): Promise<ChannelResponseDto> {
    return this.channelService.configureChannel(dto, req.user.id);
  }

  @Post(':id/subreddits')
  @UseGuards(AuthGuard('jwt'))
  async subscribeToSubreddit(
    @Param('id') id: string,
    @Body() dto: { subredditName: string },
  ): Promise<void> {
    await this.channelService.subscribeToSubreddit(id, dto.subredditName);
  }

  @Delete(':id/subreddits/:subName')
  @UseGuards(AuthGuard('jwt'))
  async unsubscribeFromSubreddit(
    @Param('id') id: string,
    @Param('subName') subName: string,
  ): Promise<void> {
    await this.channelService.unsubscribeFromSubreddit(id, subName);
  }

  @Get(':id/stream')
  async streamChannel(
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.broadcasterService.registerClient(id, res);
  }
}
