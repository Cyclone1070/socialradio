import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import * as express from 'express';
import { ChannelService } from './channel.service';
import { PlaybackService, NextTrackData } from './playback.service';
import { InternalAuthGuard } from './internal-auth.guard';
import { ConfigureChannelDto } from './dto/configure-channel.dto';
import { SubscribeSubredditDto } from './dto/subscribe-subreddit.dto';
import { ChannelResponseDto } from './dto/channel-response.dto';
import { SubredditRef } from './entities/channel.entity';

@Controller('channels')
export class ChannelController {
  constructor(
    private readonly channelService: ChannelService,
    private readonly playbackService: PlaybackService,
  ) {}

  @Get()
  @UseGuards(AuthGuard('jwt'))
  async getUserChannels(
    @Req() req: express.Request & { user: { id: string } },
  ): Promise<ChannelResponseDto[]> {
    return await this.channelService.getUserChannels(req.user.id);
  }

  @Get('active')
  @UseGuards(InternalAuthGuard)
  async getActiveChannels(): Promise<ChannelResponseDto[]> {
    return await this.channelService.getAllChannels();
  }

  @Post()
  @UseGuards(AuthGuard('jwt'))
  async configureChannel(
    @Body() dto: ConfigureChannelDto,
    @Req() req: express.Request & { user: { id: string } },
  ): Promise<ChannelResponseDto> {
    return await this.channelService.configureChannel(dto, req.user.id);
  }

  @Post(':id/subreddits')
  @UseGuards(AuthGuard('jwt'))
  async subscribeToSubreddit(
    @Param('id') id: string,
    @Body() dto: SubscribeSubredditDto,
  ): Promise<void> {
    await this.channelService.subscribeToSubreddit(id, dto.subredditName);
  }

  @Get(':id/subreddits')
  @UseGuards(AuthGuard('jwt'))
  async getChannelSubreddits(@Param('id') id: string): Promise<SubredditRef[]> {
    return await this.channelService.getSubscribedSubreddits(id);
  }

  @Delete(':id/subreddits/:subName')
  @UseGuards(AuthGuard('jwt'))
  async unsubscribeFromSubreddit(
    @Param('id') id: string,
    @Param('subName') subName: string,
  ): Promise<void> {
    await this.channelService.unsubscribeFromSubreddit(id, subName);
  }

  @Get(':id/next-track')
  @UseGuards(InternalAuthGuard)
  async getNextTrack(@Param('id') id: string): Promise<NextTrackData> {
    return await this.playbackService.getNextTrack(id);
  }
}
