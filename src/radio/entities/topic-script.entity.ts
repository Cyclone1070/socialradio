import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { Post } from '../../feed/entities/post.entity';

@Entity()
export class TopicScript {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  postId: string;

  @OneToOne(() => Post, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'postId' })
  post: Post;

  @Column('text')
  scriptText: string;

  @CreateDateColumn()
  createdAt: Date;
}
