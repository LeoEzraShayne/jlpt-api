import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateSentenceReviewDto {
  @IsString() sessionId!: string;
  @IsString() @MinLength(1) @MaxLength(150) sentence!: string;
  @IsOptional() @IsString() @MaxLength(100) scene?: string;
}
