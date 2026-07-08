import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Unique,
  Index,
} from 'typeorm';
import { Channel } from './channel.entity';
import { Subreddit } from '../../domain/entities/subreddit.entity';

@Entity()
@Unique(['channelId', 'subredditId'])
@Index(['channelId'])
export class ChannelSubreddit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  channelId: string;

  @ManyToOne(() => Channel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'channelId' })
  channel: Channel;

  @Column()
  subredditId: string;

  @ManyToOne(() => Subreddit, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subredditId' })
  subreddit: Subreddit;

  @CreateDateColumn()
  createdAt: Date;
}
