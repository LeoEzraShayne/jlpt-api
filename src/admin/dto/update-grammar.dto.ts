import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ContentStatus } from '@prisma/client';

export class UpdateGrammarDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(2000) chineseExplanation?: string;
  @IsOptional() @IsString() @MaxLength(1000) connectionRule?: string;
  @IsOptional() @IsString() @MaxLength(1000) usageScene?: string;
  @IsOptional() @IsString() @MaxLength(2000) commonErrors?: string;
}
export class UpdateGrammarStatusDto {
  @IsEnum(ContentStatus) status!: ContentStatus;
}
