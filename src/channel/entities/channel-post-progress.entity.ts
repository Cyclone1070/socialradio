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

@Entity()
@Unique(['channelId', 'postId'])
@Index(['channelId'])
export class ChannelPostProgress {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  channelId: string;

  @ManyToOne(() => Channel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'channelId' })
  channel: Channel;

  @Column()
  postId: string;

  @CreateDateColumn()
  createdAt: Date;
}
