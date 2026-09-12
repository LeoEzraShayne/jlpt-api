import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';
import { ContentQueryDto } from '../content/content.dto';

export const MANUAL_ACTIONS = [
  'UNKNOWN',
  'PRACTICE',
  'REMEMBERED',
  'PAUSE',
  'RESUME',
  'STOP_PRACTICE',
] as const;
export type ManualAction = (typeof MANUAL_ACTIONS)[number];
export class LearningActionDto {
  @IsIn(MANUAL_ACTIONS) action!: ManualAction;
}
export class LearningQueryDto extends ContentQueryDto {
  @IsOptional()
  @IsIn(['UNKNOWN', 'PRACTICE', 'REMEMBERED', 'DUE'])
  list?: 'UNKNOWN' | 'PRACTICE' | 'REMEMBERED' | 'DUE';
}
export class StartVocabularyPracticeDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) vocabularyId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) grammarId?: string;
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  studySessionId?: string;
}
export class VocabularyAnswerDto {
  @IsString() @MinLength(1) @MaxLength(300) @Matches(/\S/u) sentence!: string;
  @IsUUID() requestKey!: string;
}
