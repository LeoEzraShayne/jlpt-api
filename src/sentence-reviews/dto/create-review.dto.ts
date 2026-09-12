import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateSentenceReviewDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) requestKey?: string;
  @IsString() sessionId!: string;
  @IsString() @MinLength(1) @MaxLength(150) sentence!: string;
  @IsOptional() @IsString() @MaxLength(100) scene?: string;
}
