import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity()
export class AdTrack {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  advertiser: string;

  @Column()
  filePath: string;

  @Column('float')
  durationSeconds: number;

  @CreateDateColumn()
  createdAt: Date;
}
