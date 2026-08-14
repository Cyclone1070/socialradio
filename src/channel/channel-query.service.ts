import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChannelSubreddit } from './entities/channel-subreddit.entity';
import { ChannelPostProgress } from './entities/channel-post-progress.entity';
import { ChunkerService } from './chunker.service';
import { ChannelContract } from '../domain/contracts';

@Injectable()
export class ChannelQueryService implements ChannelContract {
  constructor(
    @InjectRepository(ChannelSubreddit)
    private readonly channelSubredditRepo: Repository<ChannelSubreddit>,
    @InjectRepository(ChannelPostProgress)
    private readonly progressRepo: Repository<ChannelPostProgress>,
    private readonly chunker: ChunkerService,
  ) {}

  async getSubredditIdsForChannel(channelId: string): Promise<string[]> {
    const subs = await this.channelSubredditRepo.find({
      where: { channelId },
    });
    return subs.map((s) => s.subredditId);
  }

  async getCompletedPostIdsForChannel(channelId: string): Promise<string[]> {
    const progress = await this.progressRepo.find({
      where: { channelId },
    });
    return progress.map((p) => p.postId);
  }

  async markPostCompletedForChannel(
    channelId: string,
    postId: string,
  ): Promise<void> {
    const progress = this.progressRepo.create({
      channelId,
      postId,
    });
    await this.progressRepo.save(progress);
  }

  async sliceAndUploadChunk(
    channelId: string,
    segmentId: string,
    audioFilePath: string,
  ): Promise<void> {
    await this.chunker.sliceAndUpload(channelId, segmentId, audioFilePath);
  }
}
