import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';

export class ConfigureChannelDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(['public', 'private'])
  @IsOptional()
  visibility?: 'public' | 'private';
}
