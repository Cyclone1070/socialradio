import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, Unique, Index } from 'typeorm';
import { Channel } from './channel.entity';
import { Topic } from '../../domain/entities/topic.entity';

@Entity()
@Unique(['channelId', 'topicId'])
@Index(['channelId'])
export class ChannelTopicProgress {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  channelId: string;

  @ManyToOne(() => Channel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'channelId' })
  channel: Channel;

  @Column()
  topicId: string;

  @ManyToOne(() => Topic, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'topicId' })
  topic: Topic;

  @Column({ default: true })
  completed: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
