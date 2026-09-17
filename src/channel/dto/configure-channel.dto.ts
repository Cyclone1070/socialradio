import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class ConfigureChannelDto {
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  name: string;

  @IsEnum(['public', 'private'])
  @IsOptional()
  visibility?: 'public' | 'private';
}
