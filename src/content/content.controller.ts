import { Controller, Get, Post, Delete, Body, UseGuards } from '@nestjs/common';
import { ScraperService, ScrapeSubredditResult } from './scraper.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subreddit } from './entities/subreddit.entity';
import { Post as PostEntity } from './entities/post.entity';
import { JwtAuthGuard } from '../user/jwt-auth.guard';
import { RolesGuard } from '../user/roles.guard';
import { Roles } from '../user/roles.decorator';

@Controller('admin/feeds')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class ContentController {
  constructor(
    private readonly scraperService: ScraperService,
    @InjectRepository(Subreddit)
    private readonly subredditRepo: Repository<Subreddit>,
    @InjectRepository(PostEntity)
    private readonly postRepo: Repository<PostEntity>,
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
    const subreddits = await this.subredditRepo.find();
    const result = [];
    for (const sub of subreddits) {
      const count = await this.postRepo.countBy({ subredditId: sub.id });
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
