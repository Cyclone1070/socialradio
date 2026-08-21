export class AdTrack {
  id!: string;
  advertiser!: string;
  filePath!: string;
  durationSeconds!: number;
  createdAt: Date = new Date();
}
