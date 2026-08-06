import { IsString, IsNotEmpty } from 'class-validator';

export class SubscribeSubredditDto {
  @IsString()
  @IsNotEmpty()
  subredditName: string;
}
