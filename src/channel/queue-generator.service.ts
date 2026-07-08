import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChannelPlaylistItem } from './entities/channel-playlist-item.entity';
import { ChannelSubreddit } from './entities/channel-subreddit.entity';
import { ChannelTopicProgress } from './entities/channel-topic-progress.entity';
import { Topic } from '../domain/entities/topic.entity';
import { RadioService } from '../radio/radio.service';
import { MediaService } from '../media/media.service';

@Injectable()
export class QueueGeneratorService {
  constructor(
    @InjectRepository(ChannelPlaylistItem)
    private readonly playlistItemRepo: Repository<ChannelPlaylistItem>,
    @InjectRepository(ChannelSubreddit)
    private readonly channelSubredditRepo: Repository<ChannelSubreddit>,
    @InjectRepository(ChannelTopicProgress)
    private readonly progressRepo: Repository<ChannelTopicProgress>,
    @InjectRepository(Topic)
    private readonly topicRepo: Repository<Topic>,
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
    const topic = await this.findPendingTopic(channelId);
    if (topic) {
      const talkItem = this.playlistItemRepo.create({
        channelId,
        sequenceOrder: nextSequence++,
        type: 'talk',
        status: 'generating',
        topicId: topic.id,
      });
      const savedTalkItem = await this.playlistItemRepo.save(talkItem);

      // Trigger background voice generation (asynchronous)
      this.radioService.getTopicVoiceTrack(topic.id)
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

  private async findPendingTopic(channelId: string): Promise<Topic | null> {
    const subs = await this.channelSubredditRepo.find({ where: { channelId } });
    if (subs.length === 0) return null;

    const completedProgress = await this.progressRepo.find({
      where: { channelId, completed: true },
    });
    const completedTopicIds = completedProgress.map(p => p.topicId);

    const subIds = subs.map(s => s.subredditId);
    // Find all topics in subscribed subreddits
    const topics = await this.topicRepo.find({
      where: subIds.map(subredditId => ({ subredditId })),
      order: { createdAt: 'ASC' },
    });

    // Find first topic not completed
    for (const topic of topics) {
      if (!completedTopicIds.includes(topic.id)) {
        return topic;
      }
    }
    return null;
  }
}
