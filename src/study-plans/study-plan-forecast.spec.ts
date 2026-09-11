import { ProgressStatus, RecallRating } from '@prisma/client';
import { calculateAdaptiveReview } from '../review/adaptive-review';
import {
  buildStudyPlanForecast,
  LEGACY_ALGORITHM_VERSION,
} from './study-plan-forecast';

const now = new Date('2026-08-12T03:00:00.000Z');

describe('study plan forecast', () => {
  it('uses the daily new limit regardless of the old time setting', () => {
    const forecast = buildStudyPlanForecast({
      timezone: 'Asia/Tokyo',
      dailyMinutes: 5,
      dailyNewLimit: 2,
      targetDate: new Date('2026-08-20T00:00:00.000Z'),
      horizonDays: 7,
      remainingNew: 2,
      items: [],
      algorithmVersion: LEGACY_ALGORITHM_VERSION,
      now,
    });
    expect(forecast.days[0]).toMatchObject({
      newCount: 2,
      estimatedMinutes: 16,
      overloaded: false,
    });
    expect(forecast.meta.isEstimate).toBe(true);
  });

  it('forecasts every due review plus capped new grammar without a time limit', () => {
    const learned = calculateAdaptiveReview({
      rating: RecallRating.REMEMBERED,
      now: new Date('2026-08-01T03:00:00.000Z'),
      timezone: 'Asia/Tokyo',
    });
    const item = (id: string) => ({
      id,
      status: ProgressStatus.NEEDS_WORK,
      stage: 1,
      masteryScore: 35,
      schedule: {
        nextReviewAt: new Date('2026-08-02T00:00:00.000Z'),
        nextReviewOn: new Date('2026-08-02T00:00:00.000Z'),
        lastReviewAt: new Date('2026-08-01T03:00:00.000Z'),
        stability: learned.stabilityAfter,
        difficulty: learned.difficultyAfter,
        fsrsState: learned.fsrsState,
        scheduledDays: learned.intervalDays,
        elapsedDays: 0,
        reps: learned.reps,
        lapses: learned.lapses,
        stateSource: learned.stateSource,
      },
    });
    const forecast = buildStudyPlanForecast({
      timezone: 'Asia/Tokyo',
      dailyMinutes: 6,
      dailyNewLimit: 2,
      targetDate: new Date('2026-08-20T00:00:00.000Z'),
      horizonDays: 7,
      remainingNew: 2,
      items: [item('one'), item('two')],
      algorithmVersion: LEGACY_ALGORITHM_VERSION,
      now,
    });
    expect(forecast.days[0]).toMatchObject({
      reviewCount: 2,
      newCount: 2,
      dueUnscheduledCount: 0,
      overloaded: false,
    });
  });

  it('returns seven visible days but simulates through the target date', () => {
    const forecast = buildStudyPlanForecast({
      timezone: 'Asia/Tokyo',
      dailyMinutes: 60,
      dailyNewLimit: 1,
      targetDate: new Date('2026-08-30T00:00:00.000Z'),
      horizonDays: 7,
      remainingNew: 10,
      items: [],
      algorithmVersion: LEGACY_ALGORITHM_VERSION,
      now,
    });
    expect(forecast.days).toHaveLength(7);
    expect(forecast.meta.projectedCompletionDate).not.toBeNull();
    expect(forecast.meta.algorithmVersion).toBe(LEGACY_ALGORITHM_VERSION);
  });
});
