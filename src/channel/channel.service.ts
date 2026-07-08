import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Channel } from './entities/channel.entity';
import { ChannelSubreddit } from './entities/channel-subreddit.entity';
import { Subreddit } from '../domain/entities/subreddit.entity';
import { ConfigureChannelDto } from './dto/configure-channel.dto';
import { ChannelResponseDto } from './dto/channel-response.dto';

@Injectable()
export class ChannelService {
  constructor(
    @InjectRepository(Channel)
    private readonly channelRepo: Repository<Channel>,
    @InjectRepository(ChannelSubreddit)
    private readonly channelSubredditRepo: Repository<ChannelSubreddit>,
    @InjectRepository(Subreddit)
    private readonly subredditRepo: Repository<Subreddit>,
  ) {}

  async configureChannel(
    dto: ConfigureChannelDto,
    ownerId: string,
  ): Promise<ChannelResponseDto> {
    const channel = this.channelRepo.create({
      name: dto.name,
      type: dto.type || 'private',
      ownerId,
    });
    const saved = await this.channelRepo.save(channel);

    return {
      id: saved.id,
      name: saved.name,
      type: saved.type,
      ownerId: saved.ownerId,
      isPaused: saved.isPaused,
      createdAt: saved.createdAt,
    };
  }

  async subscribeToSubreddit(
    channelId: string,
    subredditName: string,
  ): Promise<void> {
    let subreddit = await this.subredditRepo.findOneBy({ name: subredditName });
    if (!subreddit) {
      subreddit = this.subredditRepo.create({ name: subredditName });
      subreddit = await this.subredditRepo.save(subreddit);
    }

    const subscription = this.channelSubredditRepo.create({
      channelId,
      subredditId: subreddit.id,
    });
    await this.channelSubredditRepo.save(subscription);
  }

  async unsubscribeFromSubreddit(
    channelId: string,
    subredditName: string,
  ): Promise<void> {
    const subreddit = await this.subredditRepo.findOneBy({
      name: subredditName,
    });
    if (!subreddit) {
      throw new NotFoundException('Subreddit not found');
    }

    await this.channelSubredditRepo.delete({
      channelId,
      subredditId: subreddit.id,
    });
  }

  async getUserChannels(userId: string): Promise<ChannelResponseDto[]> {
    const channels = await this.channelRepo.find({
      where: [{ ownerId: userId }, { type: 'public' }],
    });

    return channels.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      ownerId: c.ownerId,
      isPaused: c.isPaused,
      createdAt: c.createdAt,
    }));
  }
}
