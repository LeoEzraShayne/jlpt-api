import { loadDailyBudget } from './daily-budget';

function db(input: {
  ledger?: object[];
  completed?: object[];
  active?: object[];
  oldMinutes?: number;
}) {
  return {
    studyActivityDay: {
      findMany: jest.fn().mockResolvedValue(input.ledger ?? []),
    },
    dailyStudyStat: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ studyMinutes: input.oldMinutes ?? 0 }),
    },
    studySession: {
      findMany: jest
        .fn()
        .mockImplementation(({ where }: { where: { status: string } }) =>
          Promise.resolve(
            where.status === 'ACTIVE'
              ? (input.active ?? [])
              : (input.completed ?? []),
          ),
        ),
    },
  };
}
const entry = (level: string, activeSeconds: number) => ({
  activeSeconds,
  session: { grammar: { level } },
});

describe('daily time accounting', () => {
  it('adds old completed time to ledger time without counting ledger completions twice', async () => {
    const result = await loadDailyBudget(
      db({
        oldMinutes: 17,
        ledger: [entry('N1', 300), entry('N2', 120)],
        completed: [
          {
            activeSeconds: 300,
            grammar: { level: 'N1' },
            activityDays: [{ id: 'a' }],
          },
          { activeSeconds: 600, grammar: { level: 'N1' }, activityDays: [] },
        ],
      }) as never,
      'u',
      'Asia/Tokyo',
      '2026-09-10',
      'N1',
    );
    expect(result.actual).toEqual({ PRIMARY: 15, FOUNDATION: 2 });
  });

  it('charges only today activity for a cross-day session and reserves only unfinished estimated work', async () => {
    const result = await loadDailyBudget(
      db({
        ledger: [entry('N1', 60)],
        active: [
          {
            mode: 'LEARN',
            grammar: { level: 'N1' },
            activeSeconds: 420,
            task: { estimatedMinutes: 8 },
          },
        ],
      }) as never,
      'u',
      'Asia/Tokyo',
      '2026-09-10',
      'N1',
    );
    expect(result.actual.PRIMARY).toBe(1);
    expect(result.reserved.PRIMARY).toBe(1);
    expect(result.committed.PRIMARY).toBe(2);
  });

  it('counts actively chosen manual practice in the shared budget', async () => {
    const result = await loadDailyBudget(
      db({
        ledger: [entry('N4', 180)],
        active: [
          {
            mode: 'PRACTICE',
            grammar: { level: 'N4' },
            activeSeconds: 180,
            task: null,
          },
        ],
      }) as never,
      'u',
      'Asia/Tokyo',
      '2026-09-10',
      'N1',
    );
    expect(result.actual.FOUNDATION).toBe(3);
    expect(result.reserved.FOUNDATION).toBe(1);
  });
});
