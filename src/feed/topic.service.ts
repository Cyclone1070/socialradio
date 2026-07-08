import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { Post } from './entities/post.entity';
import { Topic } from '../domain/entities/topic.entity';
import { pipeline } from '@huggingface/transformers';

type FeatureExtractionPipeline = (
  text: string,
  options?: { pooling?: string; normalize?: boolean },
) => Promise<{ data: number[] | Float32Array }>;

@Injectable()
export class TopicService {
  private extractor: FeatureExtractionPipeline | null = null;

  constructor(
    @InjectRepository(Post)
    private readonly postRepo: Repository<Post>,
    @InjectRepository(Topic)
    private readonly topicRepo: Repository<Topic>,
  ) {}

  private async getExtractor(): Promise<FeatureExtractionPipeline> {
    if (!this.extractor) {
      this.extractor = (await pipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2',
      )) as FeatureExtractionPipeline;
    }
    return this.extractor;
  }

  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  async categorizeNewPosts(
    subredditId: string,
    newPosts: Post[],
  ): Promise<void> {
    const activePosts = await this.postRepo.find({
      where: {
        subredditId,
        scrapedAt: MoreThan(new Date(Date.now() - 24 * 60 * 60 * 1000)),
      },
    });

    const embedder = await this.getExtractor();

    for (const post of newPosts) {
      const output = await embedder(post.title, {
        pooling: 'mean',
        normalize: true,
      });
      const embedding = Array.from(output.data as ArrayLike<number>);
      post.titleEmbedding = embedding;

      let bestMatch: Post | null = null;
      let bestSimilarity = -1;

      for (const active of activePosts) {
        if (active.titleEmbedding) {
          const sim = this.cosineSimilarity(embedding, active.titleEmbedding);
          if (sim > bestSimilarity) {
            bestSimilarity = sim;
            bestMatch = active;
          }
        }
      }

      if (bestSimilarity >= 0.75 && bestMatch && bestMatch.topicId) {
        post.topicId = bestMatch.topicId;
      } else {
        const topic = this.topicRepo.create({ subredditId });
        const savedTopic = await this.topicRepo.save(topic);
        post.topicId = savedTopic.id;
        activePosts.push(post); // Allow subsequent new posts to cluster with this one
      }
    }

    await this.postRepo.save(newPosts);
  }
}
