export class ChannelResponseDto {
  id: string;
  name: string;
  type: 'public' | 'private';
  ownerId: string | null;
  isPaused: boolean;
  createdAt: Date;
}
