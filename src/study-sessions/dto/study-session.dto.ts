import { IsEnum, IsOptional, IsString } from 'class-validator';
import { RecallRating, SessionMode } from '@prisma/client';

export class CreateStudySessionDto {
  @IsString() grammarId!: string;
  @IsEnum(SessionMode) mode!: SessionMode;
  @IsOptional() @IsString() taskId?: string;
}
export class CompleteStudySessionDto {
  @IsEnum(RecallRating) recallRating!: RecallRating;
  @IsOptional() @IsString() sentenceReviewId?: string;
}
