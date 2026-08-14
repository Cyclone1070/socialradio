import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Post } from './post.entity';

@Entity()
@Index(['postId'])
export class Comment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  postId: string;

  @ManyToOne(() => Post, (post) => post.comments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'postId' })
  post: Post;

  @Column({ unique: true })
  redditId: string;

  @Column('text')
  body: string;

  @Column('int')
  score: number;

  @Column({ type: 'varchar', nullable: true })
  parentRedditId: string | null;

  @Column({ default: false })
  isOp: boolean;

  @Column('timestamptz')
  redditCreatedAt: Date;
}
