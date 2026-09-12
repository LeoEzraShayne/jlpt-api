import {
  IsEnum,
  IsIn,
  IsTimeZone,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { JlptLevel, Theme } from '@prisma/client';

export class UpdatePreferencesDto {
  @IsOptional() @IsIn(['zh', 'en']) uiLocale?: 'zh' | 'en';
  @IsOptional() @IsIn(['zh', 'en']) explanationLocale?: 'zh' | 'en';
  @IsOptional() @IsInt() @Min(5) @Max(480) dailyMinutes?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) primaryShare?: number;
  @IsOptional() @IsTimeZone() timezone?: string;
  @IsOptional() @IsEnum(JlptLevel) targetLevel?: JlptLevel;
  @IsOptional() @IsEnum(Theme) colorTheme?: Theme;
  @IsOptional() @IsInt() @Min(1) @Max(10) dailyNewLimit?: number;
}
