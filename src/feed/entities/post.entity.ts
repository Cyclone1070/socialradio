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
import { Comment } from './comment.entity';

@Entity()
@Index(['subredditId'])
@Index(['scrapedAt'])
export class Post {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  subredditId: string;

  @ManyToOne(() => Subreddit, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subredditId' })
  subreddit: Subreddit;

  @Column({ unique: true })
  redditId: string;

  @Column()
  title: string;

  @Column('text')
  body: string;

  @Column('int')
  score: number;

  @Column('timestamptz')
  redditCreatedAt: Date;

  @CreateDateColumn()
  scrapedAt: Date;

  @OneToMany(() => Comment, (comment) => comment.post)
  comments: Comment[];
}
