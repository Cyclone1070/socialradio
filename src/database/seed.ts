import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { User } from '../user/entities/user.entity';
import { Subreddit } from '../domain/entities/subreddit.entity';
import { Jingle } from '../media/entities/jingle.entity';
import { MusicTrack } from '../media/entities/music-track.entity';
import { Channel } from '../channel/entities/channel.entity';
import { ChannelSubreddit } from '../channel/entities/channel-subreddit.entity';
import * as bcrypt from 'bcrypt';

export async function runSeed(
  dataSource: DataSource,
  adminEmail?: string,
  adminPassword?: string,
): Promise<void> {
  const email =
    adminEmail || process.env.ADMIN_EMAIL || 'admin@socialradio.com';
  const password =
    adminPassword || process.env.ADMIN_PASSWORD || 'AdminPass123!';

  // 1. Seed Admin User
  const userRepo = dataSource.getRepository(User);
  let adminUser = await userRepo.findOneBy({ email });
  if (!adminUser) {
    const passwordHash = await bcrypt.hash(password, 10);
    adminUser = userRepo.create({
      email,
      passwordHash,
    });
    adminUser = await userRepo.save(adminUser);
    console.log(`[SEED] Created Admin User: ${email}`);
  } else {
    console.log(`[SEED] Admin User already exists: ${email}`);
  }

  // 2. Seed Default Subreddits
  const subRepo = dataSource.getRepository(Subreddit);
  const defaultSubs = ['AskReddit', 'technology', 'todayilearned'];
  const seededSubEntities: Subreddit[] = [];

  for (const name of defaultSubs) {
    let sub = await subRepo.findOneBy({ name });
    if (!sub) {
      sub = subRepo.create({ name });
      sub = await subRepo.save(sub);
      console.log(`[SEED] Seeded Subreddit: r/${name}`);
    }
    seededSubEntities.push(sub);
  }

  // 3. Seed Starter Media Assets
  const jingleRepo = dataSource.getRepository(Jingle);
  const jingleCount = await jingleRepo.count();
  if (jingleCount === 0) {
    const jingle = jingleRepo.create({
      filePath: 'media/jingles/station_id_01.mp3',
      durationSeconds: 5,
    });
    await jingleRepo.save(jingle);
    console.log('[SEED] Seeded default station jingle ID');
  }

  const musicRepo = dataSource.getRepository(MusicTrack);
  const musicCount = await musicRepo.count();
  if (musicCount === 0) {
    const music = musicRepo.create({
      title: 'Synthwave Midnight Drive',
      artist: 'Social Radio Records',
      filePath: 'media/music/synthwave_drive.mp3',
      durationSeconds: 180,
    });
    await musicRepo.save(music);
    console.log('[SEED] Seeded default station music track');
  }

  // 4. Seed Default Radio Channel
  const channelRepo = dataSource.getRepository(Channel);
  const channelName = 'Tech & Trivia 24/7';
  let defaultChannel = await channelRepo.findOneBy({ name: channelName });
  if (!defaultChannel) {
    defaultChannel = channelRepo.create({
      name: channelName,
      ownerId: adminUser.id,
    });
    defaultChannel = await channelRepo.save(defaultChannel);
    console.log(`[SEED] Created starter Channel: ${channelName}`);
  }

  // 5. Link Subreddits to Channel
  const chanSubRepo = dataSource.getRepository(ChannelSubreddit);
  for (const sub of seededSubEntities) {
    const existingRelation = await chanSubRepo.findOneBy({
      channelId: defaultChannel.id,
      subredditId: sub.id,
    });
    if (!existingRelation) {
      const relation = chanSubRepo.create({
        channelId: defaultChannel.id,
        subredditId: sub.id,
      });
      await chanSubRepo.save(relation);
      console.log(`[SEED] Linked r/${sub.name} to channel '${channelName}'`);
    }
  }
}

async function bootstrap(): Promise<void> {
  console.log('[SEED] Starting database seed process...');
  const app = await NestFactory.createApplicationContext(AppModule);
  const dataSource = app.get(DataSource);
  const config = app.get(ConfigService);

  const adminEmail = config.get<string>('ADMIN_EMAIL');
  const adminPassword = config.get<string>('ADMIN_PASSWORD');

  try {
    await runSeed(dataSource, adminEmail, adminPassword);
    console.log('[SEED] ✅ Database seed completed successfully!');
  } catch (err) {
    console.error('[SEED] ❌ Database seed failed:', err);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void bootstrap();
}
