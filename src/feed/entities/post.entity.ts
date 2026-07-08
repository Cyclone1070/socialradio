import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { Subreddit } from '../../domain/entities/subreddit.entity';
import { Topic } from '../../domain/entities/topic.entity';
import { Comment } from './comment.entity';

@Entity()
@Index(['subredditId'])
@Index(['topicId'])
@Index(['scrapedAt'])
export class Post {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  subredditId: string;

  @ManyToOne(() => Subreddit, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subredditId' })
  subreddit: Subreddit;

  @Column({ nullable: true })
  topicId: string | null;

  @ManyToOne(() => Topic, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'topicId' })
  topic: Topic | null;

  @Column({ unique: true })
  redditId: string;

  @Column()
  title: string;

  @Column('text')
  body: string;

  @Column()
  author: string;

  @Column('int')
  score: number;

  @Column('int')
  commentCount: number;

  @Column()
  permalink: string;

  @Column('simple-json', { nullable: true })
  titleEmbedding: number[] | null;

  @Column('timestamptz')
  redditCreatedAt: Date;

  @CreateDateColumn()
  scrapedAt: Date;

  @OneToMany(() => Comment, (comment) => comment.post)
  comments: Comment[];
}
