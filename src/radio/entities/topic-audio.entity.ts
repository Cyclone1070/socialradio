import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { Topic } from '../../domain/entities/topic.entity';

@Entity()
export class TopicAudio {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  topicId: string;

  @OneToOne(() => Topic, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'topicId' })
  topic: Topic;

  @Column()
  filePath: string;

  @Column('float')
  durationSeconds: number;

  @CreateDateColumn()
  createdAt: Date;
}
