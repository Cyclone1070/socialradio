import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, Index } from 'typeorm';
import { Channel } from './channel.entity';

@Entity()
@Index(['channelId'])
@Index(['channelId', 'sequenceOrder'])
export class ChannelPlaylistItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  channelId: string;

  @ManyToOne(() => Channel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'channelId' })
  channel: Channel;

  @Column('int')
  sequenceOrder: number;

  @Column()
  type: 'talk' | 'song' | 'ad' | 'jingle';

  @Column({ nullable: true })
  audioUrl: string | null; // Local file path or cached URL

  @Column('float', { nullable: true })
  durationSeconds: number | null;

  @Column({ nullable: true })
  topicId: string | null; // Links to Topic in domain/ (if type = talk)

  @Column({ default: 'generating' })
  status: 'generating' | 'ready' | 'failed';

  @CreateDateColumn()
  createdAt: Date;
}
