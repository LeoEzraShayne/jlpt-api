import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { SessionGuard } from '../auth/session.guard';
import { CreateSentenceReviewDto } from './dto/create-review.dto';
import { SentenceReviewsService } from './sentence-reviews.service';

@Controller('sentence-reviews')
@UseGuards(SessionGuard)
@Throttle({ default: { limit: 20, ttl: 60_000 } })
export class SentenceReviewsController {
  constructor(private readonly reviews: SentenceReviewsService) {}
  @Post() @HttpCode(202) async create(
    @Req() request: Request,
    @Body() dto: CreateSentenceReviewDto,
  ) {
    return { data: await this.reviews.create(request.currentUser!.id, dto) };
  }
  @Get(':id') async get(@Req() request: Request, @Param('id') id: string) {
    return { data: await this.reviews.get(request.currentUser!.id, id) };
  }
  @Post(':id/retry') async retry(
    @Req() request: Request,
    @Param('id') id: string,
  ) {
    return { data: await this.reviews.retry(request.currentUser!.id, id) };
  }
}
