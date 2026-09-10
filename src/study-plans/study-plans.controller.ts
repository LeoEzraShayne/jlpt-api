import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { SessionGuard } from '../auth/session.guard';
import { CreateStudyPlanDto, UpdateStudyPlanDto } from './dto/study-plan.dto';
import { StudyPlansService } from './study-plans.service';

class ForecastQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(7) @Max(90) days = 30;
}

@Controller('study-plans')
@UseGuards(SessionGuard)
export class StudyPlansController {
  constructor(private readonly plans: StudyPlansService) {}
  @Post() async create(
    @Req() request: Request,
    @Body() dto: CreateStudyPlanDto,
  ) {
    return { data: await this.plans.create(request.currentUser!.id, dto) };
  }
  @Get('current') async current(@Req() request: Request) {
    return { data: await this.plans.getCurrent(request.currentUser!.id) };
  }
  @Patch('current') async update(
    @Req() request: Request,
    @Body() dto: UpdateStudyPlanDto,
  ) {
    return { data: await this.plans.update(request.currentUser!.id, dto) };
  }
  @Get('current/forecast') async forecast(
    @Req() request: Request,
    @Query() query: ForecastQueryDto,
  ) {
    const result = await this.plans.forecast(
      request.currentUser!.id,
      request.currentUser!.timezone,
      query.days,
    );
    return { data: result.days, meta: result.meta };
  }
}
