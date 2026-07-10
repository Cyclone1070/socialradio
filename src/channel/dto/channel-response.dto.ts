export class ChannelResponseDto {
  id: string;
  name: string;
  visibility: 'public' | 'private';
  ownerId: string | null;
  isPaused: boolean;
  createdAt: Date;
}
