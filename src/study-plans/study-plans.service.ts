import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StudyPlan } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CreateStudyPlanDto, UpdateStudyPlanDto } from './dto/study-plan.dto';
import { localDayUtcRange } from '../dashboard/dashboard-statistics';
import { loadDailyBudget } from '../dashboard/daily-budget';
import { localDateKey } from '../review/adaptive-review';
import { calendarDate } from './study-plan-dates';
import { forecastPlans } from './study-plan-projection';

const currentStatuses = ['ACTIVE', 'PAUSED'] as const;

@Injectable()
export class StudyPlansService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateStudyPlanDto) {
    return this.prisma.$transaction(async (tx) => {
      // Serialize with task generation and preference edits, including absent plan rows.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const existing = await tx.studyPlan.findFirst({
        where: {
          userId,
          level: dto.level,
          status: { in: [...currentStatuses] },
        },
      });
      if (existing) return existing;
      const data = {
        ...dto,
        dailyMinutes: dto.dailyMinutes ?? 20,
        startDate: calendarDate(dto.startDate),
        targetDate: calendarDate(dto.targetDate),
      };
      this.validateDates(data.startDate, data.targetDate, true);
      const grammarCount = await tx.grammarPoint.count({
        where: { level: dto.level, status: 'PUBLISHED' },
      });
      if (!grammarCount)
        throw new BadRequestException({
          code: 'LEVEL_CONTENT_PENDING',
          message: `${dto.level} content is not available yet`,
        });
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const previousCount = await tx.studyPlan.count({ where: { userId } });
      // Preserve the legacy setting for older clients; it no longer limits tasks.
      if (previousCount === 0)
        await tx.user.update({
          where: { id: userId },
          data: { dailyMinutes: dto.dailyMinutes },
        });
      return tx.studyPlan.create({
        data: {
          ...data,
          userId,
          mode:
            dto.mode ??
            (dto.level === user.targetLevel ? 'SYSTEM' : 'GAP_FILL'),
        },
      });
    });
  }

  async list(
    userId: string,
    input: {
      scope?: 'current' | 'history' | 'all';
      cursor?: string;
      limit?: number;
    } = {},
  ) {
    const limit = input.limit ?? 50;
    const where: Prisma.StudyPlanWhereInput = {
      userId,
      ...(input.scope === 'all'
        ? {}
        : {
            status:
              input.scope === 'history'
                ? { notIn: [...currentStatuses] }
                : { in: [...currentStatuses] },
          }),
    };
    const plans = await this.prisma.studyPlan.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      cursor: input.cursor ? { id: input.cursor } : undefined,
      skip: input.cursor ? 1 : 0,
      take: limit + 1,
    });
    const hasMore = plans.length > limit;
    if (hasMore) plans.pop();
    return {
      items: await Promise.all(
        plans.map((plan) => this.describe(userId, plan)),
      ),
      nextCursor: hasMore ? plans.at(-1)!.id : null,
    };
  }

  async getCurrent(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    const plan = await this.prisma.studyPlan.findFirst({
      where: {
        userId,
        level: user.targetLevel,
        status: { in: [...currentStatuses] },
      },
    });
    if (!plan)
      throw new NotFoundException({
        code: 'PLAN_NOT_INITIALIZED',
        message: 'Primary study plan not initialized',
      });
    return this.describe(userId, plan);
  }

  async getById(userId: string, id: string) {
    const plan = await this.prisma.studyPlan.findFirst({
      where: { id, userId },
    });
    if (!plan)
      throw new NotFoundException({
        code: 'PLAN_NOT_FOUND',
        message: 'Study plan not found',
      });
    return this.describe(userId, plan);
  }

  async update(userId: string, dto: UpdateStudyPlanDto) {
    const plan = await this.getCurrent(userId);
    return this.updateById(userId, plan.id, dto);
  }

  async updateById(userId: string, id: string, dto: UpdateStudyPlanDto) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const plan = await tx.studyPlan.findFirst({ where: { id, userId } });
      if (!plan)
        throw new NotFoundException({
          code: 'PLAN_NOT_FOUND',
          message: 'Study plan not found',
        });
      const changes = {
        ...dto,
        ...(dto.startDate ? { startDate: calendarDate(dto.startDate) } : {}),
        ...(dto.targetDate ? { targetDate: calendarDate(dto.targetDate) } : {}),
      };
      this.validateDates(
        changes.startDate ?? plan.startDate,
        changes.targetDate ?? plan.targetDate,
        false,
      );
      if (dto.status === 'ACTIVE' || dto.status === 'PAUSED') {
        const conflict = await tx.studyPlan.findFirst({
          where: {
            userId,
            level: plan.level,
            id: { not: id },
            status: { in: [...currentStatuses] },
          },
        });
        if (conflict)
          throw new BadRequestException({
            code: 'CURRENT_PLAN_EXISTS',
            message: 'Edit or resume the current plan for this level',
          });
      }
      // Compatibility dailyMinutes remains editable, but represents the shared budget.
      if (dto.dailyMinutes !== undefined)
        await tx.user.update({
          where: { id: userId },
          data: { dailyMinutes: dto.dailyMinutes },
        });
      return tx.studyPlan.update({ where: { id }, data: changes });
    });
  }

  async forecast(userId: string, timezone: string, days: number) {
    const plan = await this.getCurrent(userId);
    return this.forecastById(userId, plan.id, timezone, days);
  }

  async forecastById(
    userId: string,
    id: string,
    timezone: string,
    horizonDays: number,
  ) {
    const selected = await this.getById(userId, id);
    const [user, plans, progress, totals] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      this.prisma.studyPlan.findMany({ where: { userId, status: 'ACTIVE' } }),
      this.prisma.userGrammarProgress.findMany({
        where: { userId },
        include: { grammar: true, schedule: true },
      }),
      this.prisma.grammarPoint.groupBy({
        by: ['level'],
        where: { status: 'PUBLISHED' },
        _count: { _all: true },
      }),
    ]);
    const todayKey = localDateKey(timezone);
    const { start, end } = localDayUtcRange(todayKey, timezone);
    const usedTasks = await this.prisma.studyTask.findMany({
      where: {
        userId,
        type: 'LEARN',
        status: { in: ['COMPLETED', 'IN_PROGRESS'] },
        OR: [
          { completedAt: { gte: start, lt: end } },
          { status: 'IN_PROGRESS' },
        ],
      },
      select: { planId: true },
    });
    const usedNewToday: Record<string, number> = {};
    for (const task of usedTasks)
      if (task.planId)
        usedNewToday[task.planId] = (usedNewToday[task.planId] ?? 0) + 1;
    const budget = await loadDailyBudget(
      this.prisma,
      userId,
      timezone,
      localDateKey(timezone),
      user.targetLevel,
    );
    return forecastPlans({
      user,
      selected,
      plans,
      progress,
      totals,
      timezone,
      horizonDays,
      spentToday: budget.committed,
      usedNewToday,
    });
  }

  private async describe(userId: string, plan: StudyPlan) {
    const [total, learned, user] = await Promise.all([
      this.prisma.grammarPoint.count({
        where: { level: plan.level, status: 'PUBLISHED' },
      }),
      this.prisma.userGrammarProgress.count({
        where: {
          userId,
          grammar: { level: plan.level, status: 'PUBLISHED' },
          status: { not: 'NOT_STARTED' },
        },
      }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    ]);
    const isPrimary = user.targetLevel === plan.level;
    const requiredDailyNew = Math.ceil(
      Math.max(0, total - learned) /
        Math.max(
          1,
          Math.ceil((plan.targetDate.getTime() - Date.now()) / 86_400_000),
        ),
    );
    return {
      ...plan,
      dailyMinutes: user.dailyMinutes,
      isPrimary,
      totalGrammar: total,
      learnedGrammar: learned,
      remainingGrammar: Math.max(0, total - learned),
      recommendedDailyNew:
        plan.mode === 'GAP_FILL'
          ? 0
          : Math.min(plan.dailyNewLimit, requiredDailyNew),
      planAtRisk:
        plan.mode === 'SYSTEM' && requiredDailyNew > plan.dailyNewLimit,
    };
  }

  private validateDates(
    startDate: Date,
    targetDate: Date,
    requireFutureTarget: boolean,
  ) {
    if (startDate > targetDate)
      throw new BadRequestException({
        code: 'INVALID_PLAN_DATE_RANGE',
        message: 'Start date must not be after target date',
      });
    if (requireFutureTarget && targetDate <= new Date())
      throw new BadRequestException({
        code: 'INVALID_TARGET_DATE',
        message: 'Target date must be in the future',
      });
  }
}
