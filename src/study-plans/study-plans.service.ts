import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { CreateStudyPlanDto, UpdateStudyPlanDto } from './dto/study-plan.dto';
import { buildStudyPlanForecast } from './study-plan-forecast';
import { NEW_GRAMMAR_MINUTES } from '../dashboard/task-planning';
import {
  ADAPTIVE_ALGORITHM_VERSION,
  algorithmModeForUser,
  type ReviewAlgorithmMode,
} from '../review/adaptive-review';
import { LEGACY_ALGORITHM_VERSION } from './study-plan-forecast';

@Injectable()
export class StudyPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async create(userId: string, dto: CreateStudyPlanDto) {
    this.validateDates(dto.startDate, dto.targetDate, true);
    return this.prisma.$transaction(async (tx) => {
      const grammarCount = await tx.grammarPoint.count({
        where: { level: dto.level, status: 'PUBLISHED' },
      });
      if (!grammarCount)
        throw new BadRequestException({
          code: 'LEVEL_CONTENT_PENDING',
          message: `${dto.level} content is not available yet`,
        });
      await tx.studyTask.updateMany({
        where: {
          userId,
          type: 'LEARN',
          status: 'PENDING',
          plan: { status: 'ACTIVE' },
        },
        data: { status: 'SKIPPED', skipReason: 'PLAN_REPLACED' },
      });
      await tx.studyPlan.updateMany({
        where: { userId, status: 'ACTIVE' },
        data: { status: 'PAUSED' },
      });
      await tx.user.update({
        where: { id: userId },
        data: { targetLevel: dto.level },
      });
      return tx.studyPlan.create({ data: { userId, ...dto } });
    });
  }

  async getCurrent(userId: string) {
    const plan = await this.prisma.studyPlan.findFirst({
      where: { userId, status: { in: ['ACTIVE', 'PAUSED'] } },
      orderBy: { updatedAt: 'desc' },
    });
    if (!plan)
      throw new NotFoundException({
        code: 'PLAN_NOT_INITIALIZED',
        message: 'Study plan not initialized',
      });
    const total = await this.prisma.grammarPoint.count({
      where: { level: plan.level, status: 'PUBLISHED' },
    });
    const learned = await this.prisma.userGrammarProgress.count({
      where: {
        userId,
        grammar: { level: plan.level },
        status: { not: 'NOT_STARTED' },
      },
    });
    const remainingDays = Math.max(
      1,
      Math.ceil((plan.targetDate.getTime() - Date.now()) / 86_400_000),
    );
    const requiredDailyNew = Math.ceil(
      Math.max(0, total - learned) / remainingDays,
    );
    const maxNewByMinutes = Math.max(
      1,
      Math.floor(plan.dailyMinutes / NEW_GRAMMAR_MINUTES),
    );
    return {
      ...plan,
      totalGrammar: total,
      learnedGrammar: learned,
      remainingGrammar: Math.max(0, total - learned),
      recommendedDailyNew: Math.min(
        plan.dailyNewLimit,
        maxNewByMinutes,
        requiredDailyNew,
      ),
      planAtRisk:
        requiredDailyNew > plan.dailyNewLimit ||
        requiredDailyNew > maxNewByMinutes,
    };
  }

  async update(userId: string, dto: UpdateStudyPlanDto) {
    const current = await this.getCurrent(userId);
    const startDate = dto.startDate ?? current.startDate;
    const targetDate = dto.targetDate ?? current.targetDate;
    this.validateDates(startDate, targetDate, dto.targetDate !== undefined);
    return this.prisma.studyPlan.update({
      where: { id: current.id },
      data: dto,
    });
  }

  async forecast(userId: string, timezone: string, horizonDays: number) {
    const plan = await this.getCurrent(userId);
    const [progress, totalGrammar] = await Promise.all([
      this.prisma.userGrammarProgress.findMany({
        where: { userId, grammar: { level: plan.level } },
        include: { schedule: true },
      }),
      this.prisma.grammarPoint.count({
        where: { level: plan.level, status: 'PUBLISHED' },
      }),
    ]);
    const items = progress
      .filter((item) => item.schedule)
      .map((item) => ({
        id: item.grammarId,
        status: item.status,
        stage: item.stage,
        masteryScore: item.masteryScore,
        schedule: item.schedule!,
      }));
    const configuredMode =
      this.config.get<ReviewAlgorithmMode>('REVIEW_ALGORITHM_MODE') ?? 'legacy';
    const rolloutPercent =
      this.config.get<number>('REVIEW_ALGORITHM_ROLLOUT_PERCENT') ?? 0;
    const mode = algorithmModeForUser(configuredMode, rolloutPercent, userId);
    return buildStudyPlanForecast({
      timezone,
      dailyMinutes: plan.dailyMinutes,
      dailyNewLimit: plan.dailyNewLimit,
      targetDate: plan.targetDate,
      horizonDays,
      remainingNew: Math.max(0, totalGrammar - progress.length),
      items,
      algorithmVersion:
        mode === 'adaptive'
          ? ADAPTIVE_ALGORITHM_VERSION
          : LEGACY_ALGORITHM_VERSION,
    });
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
