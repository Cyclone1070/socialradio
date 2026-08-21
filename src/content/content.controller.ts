import { Controller, Get, Post, Delete, Body, UseGuards } from '@nestjs/common';
import { ScraperService, ScrapeSubredditResult } from './scraper.service';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';
import { Subreddit } from './entities/subreddit.entity';
import { Post as PostEntity } from './entities/post.entity';
import {
  SubredditSchema,
  PostSchema,
} from '../infrastructure/database/schemas/content.schema';
import { JwtAuthGuard, RolesGuard, Roles } from '../infrastructure/auth';

@Controller('admin/feeds')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class ContentController {
  constructor(
    private readonly scraperService: ScraperService,
    @InjectRepository(SubredditSchema)
    private readonly subredditRepo: EntityRepository<Subreddit>,
    @InjectRepository(PostSchema)
    private readonly postRepo: EntityRepository<PostEntity>,
  ) {}

  @Post('scrape')
  async scrape(
    @Body() body: { subredditName: string },
  ): Promise<ScrapeSubredditResult> {
    const normalizedName = body.subredditName.trim().toLowerCase();
    return this.scraperService.scrapeSubreddit(normalizedName);
  }

  @Delete('cache')
  async cleanCache(): Promise<void> {
    await this.scraperService.cleanupOldData();
  }

  @Get('subreddits')
  async getSubreddits(): Promise<
    Array<{
      id: string;
      name: string;
      lastScrapedAt: Date | null;
      postCount: number;
    }>
  > {
    const subreddits = await this.subredditRepo.findAll();
    const result = [];
    for (const sub of subreddits) {
      const count = await this.postRepo.count({
        subreddit: sub.id,
      });
      result.push({
        id: sub.id,
        name: sub.name,
        lastScrapedAt: sub.lastScrapedAt,
        postCount: count,
      });
    }
    return result;
  }
}
