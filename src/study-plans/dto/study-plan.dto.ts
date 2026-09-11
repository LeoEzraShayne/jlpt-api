import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { JlptLevel, StudyPlanStatus, StudyPlanMode } from '@prisma/client';

export class CreateStudyPlanDto {
  @IsOptional() @IsEnum(StudyPlanMode) mode?: StudyPlanMode;
  @IsEnum(JlptLevel) level!: JlptLevel;
  @Type(() => Date) @IsDate() startDate!: Date;
  @Type(() => Date) @IsDate() targetDate!: Date;
  @IsOptional() @IsInt() @Min(5) @Max(480) dailyMinutes?: number;
  @IsInt() @Min(1) @Max(10) dailyNewLimit!: number;
}

export class UpdateStudyPlanDto {
  @IsOptional() @IsEnum(StudyPlanMode) mode?: StudyPlanMode;
  @IsOptional() @IsEnum(StudyPlanStatus) status?: StudyPlanStatus;
  @IsOptional() @Type(() => Date) @IsDate() startDate?: Date;
  @IsOptional() @Type(() => Date) @IsDate() targetDate?: Date;
  @IsOptional() @IsInt() @Min(5) @Max(480) dailyMinutes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(10) dailyNewLimit?: number;
}
