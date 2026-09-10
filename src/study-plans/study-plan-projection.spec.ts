import { forecastPlans } from './study-plan-projection';
import { calculateAdaptiveReview } from '../review/adaptive-review';

const now = new Date('2026-09-10T03:00:00Z');
const plan = (level: 'N1' | 'N2', mode = 'SYSTEM') => ({
  id: level,
  level,
  mode,
  status: 'ACTIVE',
  startDate: new Date('2026-01-01'),
  targetDate: new Date('2026-12-01'),
  dailyNewLimit: 4,
});
function input() {
  return {
    user: { dailyMinutes: 40, primaryShare: 80, targetLevel: 'N1' as const },
    selected: plan('N1'),
    plans: [plan('N1'), plan('N2', 'GAP_FILL')],
    progress: [],
    totals: [
      { level: 'N1', _count: { _all: 100 } },
      { level: 'N2', _count: { _all: 100 } },
    ],
    timezone: 'Asia/Tokyo',
    horizonDays: 7,
    now,
  };
}

describe('shared FSRS plan projection', () => {
  it('uses production FSRS dates after initial learning rather than fixed repetition intervals', () => {
    const options = input();
    options.totals[0]._count._all = 1;
    const result = forecastPlans(options as never);
    const actual = calculateAdaptiveReview({
      rating: 'REMEMBERED',
      now,
      timezone: options.timezone,
    });
    expect(result.days[0].newCount).toBe(1);
    const next = actual.nextReviewOn.toISOString().slice(0, 10);
    const reviewDay = result.days.find((day) => day.date === next);
    expect(reviewDay).toMatchObject({ reviewCount: 1 });
    expect(result.meta.algorithmVersion).toBe('adaptive-v1');
  });

  it('has no forced work after today budget was already spent', () => {
    const result = forecastPlans({
      ...input(),
      spentToday: { PRIMARY: 35, FOUNDATION: 5 },
    } as never);
    expect(result.days[0].estimatedMinutes).toBe(0);
    expect(result.days[1].newCount).toBeGreaterThan(0);
  });

  it('does not schedule before the start date or reactivate paused plans', () => {
    const options = input();
    options.plans[0].startDate = new Date('2026-09-12');
    options.selected = options.plans[0];
    const result = forecastPlans(options as never);
    expect(result.days.slice(0, 2).map((day) => day.estimatedMinutes)).toEqual([
      0, 0,
    ]);
    expect(result.days[2].newCount).toBeGreaterThan(0);
    expect(
      forecastPlans({
        ...options,
        plans: [],
        selected: { ...options.selected, status: 'PAUSED' },
      } as never).days.every((day) => day.estimatedMinutes === 0),
    ).toBe(true);
  });
});
