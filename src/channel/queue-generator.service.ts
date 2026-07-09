import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChannelPlaylistItem } from './entities/channel-playlist-item.entity';
import { ChannelSubreddit } from './entities/channel-subreddit.entity';
import { ChannelPostProgress } from './entities/channel-post-progress.entity';
import { Post } from '../feed/entities/post.entity';
import { RadioService } from '../radio/radio.service';
import { MediaService } from '../media/media.service';
import { clusterPosts } from './utils/topic-clustering.util';

@Injectable()
export class QueueGeneratorService {
  constructor(
    @InjectRepository(ChannelPlaylistItem)
    private readonly playlistItemRepo: Repository<ChannelPlaylistItem>,
    @InjectRepository(ChannelSubreddit)
    private readonly channelSubredditRepo: Repository<ChannelSubreddit>,
    @InjectRepository(ChannelPostProgress)
    private readonly progressRepo: Repository<ChannelPostProgress>,
    @InjectRepository(Post)
    private readonly postRepo: Repository<Post>,
    private readonly radioService: RadioService,
    private readonly mediaService: MediaService,
  ) {}

  async bufferAhead(channelId: string): Promise<void> {
    const count = await this.playlistItemRepo.count({ where: { channelId } });
    if (count >= 5) {
      return; // Already has enough items buffered
    }

    const lastItem = await this.playlistItemRepo.findOne({
      where: { channelId },
      order: { sequenceOrder: 'DESC' },
    });
    let nextSequence = lastItem ? lastItem.sequenceOrder + 1 : 1;

    // Jingle (ready)
    const jingleSegment = await this.mediaService.getRandomJingle();
    const jingleItem = this.playlistItemRepo.create({
      channelId,
      sequenceOrder: nextSequence++,
      type: 'jingle',
      audioUrl: jingleSegment.filePath,
      durationSeconds: jingleSegment.durationSeconds,
      status: 'ready',
    });
    await this.playlistItemRepo.save(jingleItem);

    // Talk (generating)
    const topicSegment = await this.findPendingTopicSegment(channelId);
    if (topicSegment) {
      const talkItem = this.playlistItemRepo.create({
        channelId,
        sequenceOrder: nextSequence++,
        type: 'talk',
        status: 'generating',
        topicId: topicSegment.id,
      });
      const savedTalkItem = await this.playlistItemRepo.save(talkItem);

      // Immediately mark posts as completed to prevent double-queuing
      for (const p of topicSegment.posts) {
        const progress = this.progressRepo.create({
          channelId,
          postId: p.id,
        });
        await this.progressRepo.save(progress);
      }

      // Trigger background voice generation (asynchronous)
      const postIds = topicSegment.posts.map((p) => p.id);
      this.radioService
        .getSegmentVoiceTrack(postIds)
        .then(async (segment) => {
          savedTalkItem.audioUrl = segment.filePath;
          savedTalkItem.durationSeconds = segment.durationSeconds;
          savedTalkItem.status = 'ready';
          await this.playlistItemRepo.save(savedTalkItem);
        })
        .catch(async () => {
          savedTalkItem.status = 'failed';
          await this.playlistItemRepo.save(savedTalkItem);
        });
    } else {
      // Fallback if no topics: insert extra song instead
      const fallbackSong = await this.mediaService.getRandomMusic();
      const songItem = this.playlistItemRepo.create({
        channelId,
        sequenceOrder: nextSequence++,
        type: 'song',
        audioUrl: fallbackSong.filePath,
        durationSeconds: fallbackSong.durationSeconds,
        status: 'ready',
      });
      await this.playlistItemRepo.save(songItem);
    }

    // Song (ready)
    const songSegment1 = await this.mediaService.getRandomMusic();
    const songItem1 = this.playlistItemRepo.create({
      channelId,
      sequenceOrder: nextSequence++,
      type: 'song',
      audioUrl: songSegment1.filePath,
      durationSeconds: songSegment1.durationSeconds,
      status: 'ready',
    });
    await this.playlistItemRepo.save(songItem1);

    // Ad (ready)
    const adSegment = await this.mediaService.getRandomAd();
    const adItem = this.playlistItemRepo.create({
      channelId,
      sequenceOrder: nextSequence++,
      type: 'ad',
      audioUrl: adSegment.filePath,
      durationSeconds: adSegment.durationSeconds,
      status: 'ready',
    });
    await this.playlistItemRepo.save(adItem);

    // Song (ready)
    const songSegment2 = await this.mediaService.getRandomMusic();
    const songItem2 = this.playlistItemRepo.create({
      channelId,
      sequenceOrder: nextSequence++,
      type: 'song',
      audioUrl: songSegment2.filePath,
      durationSeconds: songSegment2.durationSeconds,
      status: 'ready',
    });
    await this.playlistItemRepo.save(songItem2);
  }

  private async findPendingTopicSegment(
    channelId: string,
  ): Promise<{ id: string; title: string; posts: Post[] } | null> {
    const subs = await this.channelSubredditRepo.find({ where: { channelId } });
    if (subs.length === 0) return null;

    const completedProgress = await this.progressRepo.find({
      where: { channelId },
    });
    const completedPostIds = completedProgress.map((p) => p.postId);

    const subIds = subs.map((s) => s.subredditId);
    const posts = await this.postRepo.find({
      where: subIds.map((subredditId) => ({ subredditId })),
      order: { score: 'DESC', redditCreatedAt: 'DESC' },
    });

    const unplayedPosts = posts.filter((p) => !completedPostIds.includes(p.id));
    if (unplayedPosts.length === 0) return null;

    const segments = clusterPosts(unplayedPosts);
    return segments[0] || null;
  }
}
