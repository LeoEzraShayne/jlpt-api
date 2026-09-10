import { IsString, MaxLength, MinLength } from 'class-validator';

export class ImportGrammarDto {
  @IsString() @MinLength(1) @MaxLength(100) fileName!: string;
  @IsString() @MinLength(100) @MaxLength(200_000) content!: string;
}
