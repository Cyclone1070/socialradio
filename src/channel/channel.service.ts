import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository, EntityManager } from '@mikro-orm/postgresql';
import { Channel, SubredditRef } from './entities/channel.entity';
import { ChannelSchema } from '../infrastructure/database/schemas/channel.schema';
import { ConfigureChannelDto } from './dto/configure-channel.dto';
import { ChannelResponseDto } from './dto/channel-response.dto';
import { ContentContract } from '../domain/contracts';
import { createServiceLogger } from '../infrastructure/logging/logging.module';

@Injectable()
export class ChannelService {
  private readonly logger = createServiceLogger(ChannelService.name);

  constructor(
    @InjectRepository(ChannelSchema)
    private readonly channelRepo: EntityRepository<Channel>,
    private readonly em: EntityManager,
    private readonly contentContract: ContentContract,
  ) {}

  async configureChannel(
    dto: ConfigureChannelDto,
    ownerId: string,
  ): Promise<ChannelResponseDto> {
    const channel = new Channel();
    channel.name = dto.name;
    channel.visibility = dto.visibility || 'private';
    channel.ownerId = ownerId;

    await this.em.persist(channel).flush();

    return {
      id: channel.id,
      name: channel.name,
      visibility: channel.visibility,
      ownerId: channel.ownerId,
      createdAt: channel.createdAt,
    };
  }

  async subscribeToSubreddit(
    channelId: string,
    subredditName: string,
  ): Promise<void> {
    const channel = await this.channelRepo.findOne(
      { id: channelId },
      { populate: ['subreddits'] },
    );
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

    const subreddits = channel.subreddits.getItems();
    const existing = subreddits.find(
      (s: SubredditRef) => s.id === subreddit.id || s.name === normalizedName,
    );
    if (existing) {
      return;
    }

    const subRef = this.em.getReference<SubredditRef>(
      'Subreddit',
      subreddit.id,
    );
    channel.subreddits.add(subRef);
    await this.em.flush();
  }

  async unsubscribeFromSubreddit(
    channelId: string,
    subredditName: string,
  ): Promise<void> {
    const normalizedName = subredditName.trim().toLowerCase();
    const subreddit =
      await this.contentContract.getSubredditByName(normalizedName);
    if (!subreddit) {
      throw new NotFoundException('Subreddit not found');
    }

    const channel = await this.channelRepo.findOne(
      { id: channelId },
      { populate: ['subreddits'] },
    );
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    const subreddits = channel.subreddits.getItems();
    const existing = subreddits.find(
      (s: SubredditRef) => s.id === subreddit.id || s.name === normalizedName,
    );
    if (!existing) {
      throw new NotFoundException('Subreddit not found');
    }

    channel.subreddits.remove(existing);
    await this.em.flush();
  }

  async getSubscribedSubreddits(channelId: string): Promise<SubredditRef[]> {
    const channel = await this.channelRepo.findOne(
      { id: channelId },
      { populate: ['subreddits'] },
    );
    if (!channel) return [];
    return channel.subreddits.getItems().map((s: SubredditRef) => ({
      id: s.id,
      name: s.name,
    }));
  }

  async getUserChannels(ownerId: string): Promise<ChannelResponseDto[]> {
    const channels = await this.channelRepo.find({ ownerId });
    return channels.map((c) => ({
      id: c.id,
      name: c.name,
      visibility: c.visibility,
      ownerId: c.ownerId,
      createdAt: c.createdAt,
    }));
  }

  async getAllChannels(): Promise<ChannelResponseDto[]> {
    const channels = await this.channelRepo.findAll();
    return channels.map((c) => ({
      id: c.id,
      name: c.name,
      visibility: c.visibility,
      ownerId: c.ownerId,
      createdAt: c.createdAt,
    }));
  }

  async getChannel(id: string): Promise<ChannelResponseDto> {
    const channel = await this.channelRepo.findOne({ id });
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
