import {
  Body,
  Controller,
  Get,
  Patch,
  Param,
  Post,
  Req,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Type } from 'class-transformer';
import { IsIn, IsString, IsInt, IsOptional, Max, Min } from 'class-validator';
import { SessionGuard } from '../auth/session.guard';
import { CreateStudyPlanDto, UpdateStudyPlanDto } from './dto/study-plan.dto';
import { StudyPlansService } from './study-plans.service';

class ForecastQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(7) @Max(90) days = 30;
}

class PlansQueryDto {
  @IsOptional() @IsIn(['current', 'history', 'all']) scope?:
    'current' | 'history' | 'all';
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
}

@Controller('study-plans')
@UseGuards(SessionGuard)
export class StudyPlansController {
  constructor(private readonly plans: StudyPlansService) {}
  @Get() async list(@Req() request: Request, @Query() query: PlansQueryDto) {
    return { data: await this.plans.list(request.currentUser!.id, query) };
  }
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
  @Get(':id') async detail(@Req() request: Request, @Param('id') id: string) {
    return { data: await this.plans.getById(request.currentUser!.id, id) };
  }
  @Patch(':id') async edit(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() dto: UpdateStudyPlanDto,
  ) {
    return {
      data: await this.plans.updateById(request.currentUser!.id, id, dto),
    };
  }
  @Get(':id/forecast') async forecastPlan(
    @Req() request: Request,
    @Param('id') id: string,
    @Query() query: ForecastQueryDto,
  ) {
    const result = await this.plans.forecastById(
      request.currentUser!.id,
      id,
      request.currentUser!.timezone,
      query.days,
    );
    return { data: result.days, meta: result.meta };
  }
}
