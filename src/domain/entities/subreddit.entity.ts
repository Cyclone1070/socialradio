import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Unique } from 'typeorm';

@Entity()
@Unique(['name'])
export class Subreddit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'timestamptz', nullable: true })
  lastScrapedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
