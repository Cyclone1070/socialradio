import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TopicScript } from './entities/topic-script.entity';
import { TopicAudio } from './entities/topic-audio.entity';
import { Post } from '../feed/entities/post.entity';
import { Comment } from '../feed/entities/comment.entity';
import { ScriptService } from './script.service';
import { AudioService } from './audio.service';
import { Segment } from '../domain/types/segment.interface';
import * as path from 'path';

@Injectable()
export class RadioService {
  constructor(
    @InjectRepository(TopicScript)
    private readonly scriptRepo: Repository<TopicScript>,
    @InjectRepository(TopicAudio)
    private readonly audioRepo: Repository<TopicAudio>,
    @InjectRepository(Post)
    private readonly postRepo: Repository<Post>,
    @InjectRepository(Comment)
    private readonly commentRepo: Repository<Comment>,
    private readonly scriptService: ScriptService,
    private readonly audioService: AudioService,
  ) {}

  async getSegmentVoiceTrack(postIds: string[]): Promise<Segment> {
    const primaryPostId = postIds[0];
    const cachedAudio = await this.audioRepo.findOneBy({
      postId: primaryPostId,
    });
    if (cachedAudio) {
      return {
        filePath: cachedAudio.filePath,
        durationSeconds: cachedAudio.durationSeconds,
      };
    }

    const posts = await this.postRepo.find({
      where: postIds.map((id) => ({ id })),
    });

    let comments: Comment[] = [];
    if (postIds.length > 0) {
      comments = await this.commentRepo.find({
        where: postIds.map((postId) => ({ postId })),
      });
    }

    const scriptText = await this.scriptService.generateScript(posts, comments);
    const outputFilePath = path.join(
      'assets',
      'cache',
      `tts-post-${primaryPostId}.mp3`,
    );

    const durationSeconds = await this.audioService.generateSpeech(
      scriptText,
      outputFilePath,
    );

    const script = this.scriptRepo.create({
      postId: primaryPostId,
      scriptText,
    });
    await this.scriptRepo.save(script);

    const audio = this.audioRepo.create({
      postId: primaryPostId,
      filePath: outputFilePath,
      durationSeconds,
    });
    const savedAudio = await this.audioRepo.save(audio);

    return {
      filePath: savedAudio.filePath,
      durationSeconds: savedAudio.durationSeconds,
    };
  }
}
