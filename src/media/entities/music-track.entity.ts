import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity()
export class MusicTrack {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column()
  artist: string;

  @Column()
  filePath: string;

  @Column('float')
  durationSeconds: number;

  @CreateDateColumn()
  createdAt: Date;
}
