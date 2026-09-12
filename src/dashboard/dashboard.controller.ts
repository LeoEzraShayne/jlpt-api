import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard';
import { DashboardService } from './dashboard.service';
import {
  ContentLocalizationService,
  contentLocale,
} from '../content-localization/content-localization.service';

@Controller('dashboard')
@UseGuards(SessionGuard)
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly localization: ContentLocalizationService,
  ) {}
  @Get('today') async getToday(@Req() request: Request) {
    const data = await this.dashboard.getToday(
      request.currentUser!.id,
      request.currentUser!.timezone,
    );
    const grammars = await this.localization.grammar(
      data.tasks.flatMap((task) => (task.grammar ? [task.grammar] : [])),
      contentLocale(request.currentUser!.explanationLocale),
    );
    const byId = new Map(grammars.map((grammar) => [grammar.id, grammar]));
    return {
      data: {
        ...data,
        tasks: data.tasks.map((task) => ({
          ...task,
          grammar: task.grammar ? byId.get(task.grammar.id)! : task.grammar,
        })),
      },
    };
  }
}
