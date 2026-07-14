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
  visibility: 'public' | 'private';

  @Column({ nullable: true })
  ownerId: string | null;

  @Column({ nullable: true })
  currentSegmentId: string | null;

  @Column({ type: 'timestamp', nullable: true })
  lastRequestedAt: Date | null;

  @Column('float', { default: 0 })
  playheadOffsetSeconds: number;

  @CreateDateColumn()
  createdAt: Date;
}
