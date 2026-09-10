import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(SessionGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}
  @Get('today') async getToday(@Req() request: Request) {
    return {
      data: await this.dashboard.getToday(
        request.currentUser!.id,
        request.currentUser!.timezone,
      ),
    };
  }
}
