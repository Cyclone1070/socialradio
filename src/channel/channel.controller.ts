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
  Inject,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import * as express from 'express';
import { ChannelService } from './channel.service';
import { ChannelPlaybackService } from './channel-playback.service';
import { ConfigureChannelDto } from './dto/configure-channel.dto';
import { ChannelResponseDto } from './dto/channel-response.dto';
import type { StorageService } from '../domain/types/storage.interface';

@Controller('channels')
export class ChannelController {
  constructor(
    private readonly channelService: ChannelService,
    private readonly playbackService: ChannelPlaybackService,
    @Inject('StorageService')
    private readonly storageService: StorageService,
  ) {}

  @Get()
  @UseGuards(AuthGuard('jwt'))
  async getUserChannels(
    @Req() req: express.Request & { user: { id: string } },
  ): Promise<ChannelResponseDto[]> {
    return this.channelService.getUserChannels(req.user.id);
  }

  @Post()
  @UseGuards(AuthGuard('jwt'))
  async configureChannel(
    @Body() dto: ConfigureChannelDto,
    @Req() req: express.Request & { user: { id: string } },
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

  @Get(':id/subreddits')
  @UseGuards(AuthGuard('jwt'))
  async getChannelSubreddits(
    @Param('id') id: string,
  ): Promise<{ id: string; name: string }[]> {
    return this.channelService.getChannelSubreddits(id);
  }

  @Delete(':id/subreddits/:subName')
  @UseGuards(AuthGuard('jwt'))
  async unsubscribeFromSubreddit(
    @Param('id') id: string,
    @Param('subName') subName: string,
  ): Promise<void> {
    await this.channelService.unsubscribeFromSubreddit(id, subName);
  }

  @Get(':id/playlist.m3u8')
  async getPlaylistManifest(
    @Param('id') id: string,
    @Res() res: express.Response,
  ): Promise<void> {
    try {
      const manifest = await this.playbackService.getPlaylistManifest(id);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.send(manifest);
    } catch (err: unknown) {
      res
        .status(404)
        .send(err instanceof Error ? err.message : 'Manifest not ready');
    }
  }

  @Get(':id/chunks/:filename')
  async getAudioChunk(
    @Param('id') id: string,
    @Param('filename') filename: string,
    @Res() res: express.Response,
  ): Promise<void> {
    const chunkPath = `channels/${id}/chunks/${filename}`;
    const exists = await this.storageService.exists(chunkPath);
    if (!exists) {
      res.status(404).send('Chunk not found');
      return;
    }
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    const audioBuffer = await this.storageService.read(chunkPath);
    res.send(audioBuffer);
  }
}
