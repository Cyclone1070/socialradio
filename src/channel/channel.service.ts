import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Channel } from './entities/channel.entity';
import { ChannelSubreddit } from './entities/channel-subreddit.entity';
import { ConfigureChannelDto } from './dto/configure-channel.dto';
import { ChannelResponseDto } from './dto/channel-response.dto';
import { ContentContract } from '../domain/contracts';
import { createServiceLogger } from '../infrastructure/logging/logging.module';

@Injectable()
export class ChannelService {
  private readonly logger = createServiceLogger(ChannelService.name);

  constructor(
    @InjectRepository(Channel)
    private readonly channelRepo: Repository<Channel>,
    @InjectRepository(ChannelSubreddit)
    private readonly channelSubredditRepo: Repository<ChannelSubreddit>,
    private readonly contentContract: ContentContract,
  ) {}

  async configureChannel(
    dto: ConfigureChannelDto,
    ownerId: string,
  ): Promise<ChannelResponseDto> {
    const channel = this.channelRepo.create({
      name: dto.name,
      visibility: dto.visibility || 'private',
      ownerId,
    });
    const saved = await this.channelRepo.save(channel);

    return {
      id: saved.id,
      name: saved.name,
      visibility: saved.visibility,
      ownerId: saved.ownerId,
      createdAt: saved.createdAt,
    };
  }

  async subscribeToSubreddit(
    channelId: string,
    subredditName: string,
  ): Promise<void> {
    const channel = await this.channelRepo.findOneBy({ id: channelId });
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    const normalizedName = subredditName.trim().toLowerCase();
    let subreddit =
      await this.contentContract.getSubredditByName(normalizedName);

    if (!subreddit) {
      this.logger.info(
        { channelId, subreddit: normalizedName },
        'subscribing to un-scraped subreddit, triggering initial scrape',
      );
      await this.contentContract.scrapeSubreddit(normalizedName);
      subreddit = await this.contentContract.getSubredditByName(normalizedName);

      if (!subreddit) {
        throw new NotFoundException(
          `Subreddit "${normalizedName}" could not be scraped or found.`,
        );
      }
    }

    const existing = await this.channelSubredditRepo.findOneBy({
      channelId,
      subredditId: subreddit.id,
    });
    if (existing) {
      throw new BadRequestException(
        `Channel is already subscribed to r/${normalizedName}`,
      );
    }

    const sub = this.channelSubredditRepo.create({
      channelId,
      subredditId: subreddit.id,
    });
    await this.channelSubredditRepo.save(sub);
  }

  async unsubscribeFromSubreddit(
    channelId: string,
    subredditName: string,
  ): Promise<void> {
    const normalizedName = subredditName.trim().toLowerCase();
    const subreddit =
      await this.contentContract.getSubredditByName(normalizedName);
    if (!subreddit) {
      throw new NotFoundException(`Subreddit r/${normalizedName} not found`);
    }

    const sub = await this.channelSubredditRepo.findOneBy({
      channelId,
      subredditId: subreddit.id,
    });
    if (!sub) {
      throw new NotFoundException(
        `Channel is not subscribed to r/${normalizedName}`,
      );
    }

    await this.channelSubredditRepo.remove(sub);
  }

  async getSubscribedSubreddits(channelId: string): Promise<string[]> {
    const subs = await this.channelSubredditRepo.find({
      where: { channelId },
    });
    if (subs.length === 0) return [];
    const subreddits = await this.contentContract.getSubredditsByIds(
      subs.map((s) => s.subredditId),
    );
    return subreddits.map((s) => s.name);
  }

  async getUserChannels(ownerId: string): Promise<ChannelResponseDto[]> {
    const channels = await this.channelRepo.find({ where: { ownerId } });
    return channels.map((c) => ({
      id: c.id,
      name: c.name,
      visibility: c.visibility,
      ownerId: c.ownerId,
      createdAt: c.createdAt,
    }));
  }

  async getAllChannels(): Promise<ChannelResponseDto[]> {
    const channels = await this.channelRepo.find();
    return channels.map((c) => ({
      id: c.id,
      name: c.name,
      visibility: c.visibility,
      ownerId: c.ownerId,
      createdAt: c.createdAt,
    }));
  }

  async getChannel(id: string): Promise<ChannelResponseDto> {
    const channel = await this.channelRepo.findOneBy({ id });
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }
    return {
      id: channel.id,
      name: channel.name,
      visibility: channel.visibility,
      ownerId: channel.ownerId,
      createdAt: channel.createdAt,
    };
  }
}
