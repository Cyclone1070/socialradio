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

  @Column({ type: 'varchar', nullable: true })
  ownerId: string | null;

  @Column({ type: 'varchar', nullable: true })
  currentSegmentId: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
