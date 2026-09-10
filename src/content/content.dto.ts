import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { JlptLevel } from '@prisma/client';

export class ContentQueryDto {
  @IsOptional() @IsString() @MaxLength(100) query?: string;
  @IsOptional() @IsEnum(JlptLevel) level?: JlptLevel;
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}
export class ExpressionQueryDto extends ContentQueryDto {
  @IsOptional() @IsString() grammarId?: string;
}
export class NoteDto {
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}
export class SaveExpressionDto extends NoteDto {
  @IsString() @MinLength(1) reviewId!: string;
  @IsIn(['ORIGINAL', 'CORRECTION', 'ALTERNATIVE']) variant!: string;
}
export class CandidateRowDto {
  @IsIn(['VOCABULARY', 'PHRASE']) kind!: string;
  @IsString() @MinLength(1) @MaxLength(500) word!: string;
  @IsString() @MaxLength(500) reading!: string;
  @IsString() @MinLength(1) @MaxLength(2000) gloss!: string;
  @IsOptional() @IsString() @MaxLength(100) senseKey?: string;
  @IsOptional() @IsEnum(JlptLevel) level?: JlptLevel;
  @IsOptional() @IsString() @MaxLength(500) levelSource?: string;
  @IsOptional() @IsString() @MaxLength(1000) location?: string;
}
export class PreviewImportDto {
  @IsString() @MinLength(1) @MaxLength(255) fileName!: string;
  @IsString() @MinLength(1) @MaxLength(500) sourceName!: string;
  @IsString() @MinLength(1) @MaxLength(100) sourceVersion!: string;
  @IsOptional() @IsString() @MaxLength(2000) sourceUrl?: string;
  @IsOptional() @IsString() @MaxLength(200) license?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => CandidateRowDto)
  rows!: CandidateRowDto[];
}
export class ValidateCandidateDto {
  @IsIn(['VALIDATED', 'REJECTED', 'PENDING']) status!: string;
  @IsString() @MinLength(1) @MaxLength(2000) note!: string;
  @IsBoolean() checkedAgainstSource!: boolean;
}
