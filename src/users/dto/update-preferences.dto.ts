import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { JlptLevel, Theme } from '@prisma/client';

export class UpdatePreferencesDto {
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsEnum(JlptLevel) targetLevel?: JlptLevel;
  @IsOptional() @IsEnum(Theme) colorTheme?: Theme;
  @IsOptional() @IsInt() @Min(1) @Max(10) dailyNewLimit?: number;
}
