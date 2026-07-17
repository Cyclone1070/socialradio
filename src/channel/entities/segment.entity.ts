import {
  Entity,
  TableInheritance,
  ChildEntity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { Channel } from './channel.entity';

@Entity()
@TableInheritance({ column: { type: 'varchar', name: 'type' } })
@Index(['channelId'])
@Index(['channelId', 'playOrder'])
export abstract class Segment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  channelId: string;

  @ManyToOne(() => Channel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'channelId' })
  channel: Channel;

  @Column('int')
  playOrder: number;

  @Column({ type: 'varchar', nullable: true })
  audioUrl: string | null;

  @Column('float', { nullable: true })
  durationSeconds: number | null;

  @CreateDateColumn()
  createdAt: Date;
}

@ChildEntity('song')
export class SongSegment extends Segment {
  @Column()
  title: string;

  @Column()
  artist: string;
}

@ChildEntity('talk')
export class TalkSegment extends Segment {
  @Column()
  topicId: string;

  @Column({ default: 'generating' })
  status: 'generating' | 'ready' | 'failed';
}

@ChildEntity('ad')
export class AdSegment extends Segment {}

@ChildEntity('jingle')
export class JingleSegment extends Segment {}
