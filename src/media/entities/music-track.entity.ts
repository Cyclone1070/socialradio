export class MusicTrack {
  id!: string;
  title!: string;
  artist!: string;
  filePath!: string;
  durationSeconds!: number;
  createdAt: Date = new Date();
}
