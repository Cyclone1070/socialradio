import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Subreddit } from './subreddit.entity';

@Entity()
@Index(['subredditId'])
export class Topic {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  subredditId: string;

  @ManyToOne(() => Subreddit)
  @JoinColumn({ name: 'subredditId' })
  subreddit: Subreddit;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
