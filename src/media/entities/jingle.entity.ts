import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity()
export class Jingle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  filePath: string;

  @Column('float')
  durationSeconds: number;

  @CreateDateColumn()
  createdAt: Date;
}
