import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity()
export class TopicAudio {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  postId: string;

  @Column()
  filePath: string;

  @Column('float')
  durationSeconds: number;

  @CreateDateColumn()
  createdAt: Date;
}
