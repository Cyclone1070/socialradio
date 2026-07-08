import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity()
export class Channel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ default: 'public' })
  type: 'public' | 'private';

  @Column({ nullable: true })
  ownerId: string | null;

  @Column({ default: true })
  isPaused: boolean;

  @Column({ nullable: true })
  currentPlaylistItemId: string | null;

  @Column('float', { default: 0 })
  pausedOffsetSeconds: number;

  @CreateDateColumn()
  createdAt: Date;
}
