import { allocateDailyBudget, AllocationCandidate } from './daily-allocation';

const work = (
  id: string,
  group: 'PRIMARY' | 'FOUNDATION',
  type: 'LEARN' | 'REVIEW',
  minutes = type === 'LEARN' ? 8 : 4,
): AllocationCandidate => ({ id, group, type, minutes, planId: group });
const allocate = (
  candidates: AllocationCandidate[],
  overrides: Partial<Parameters<typeof allocateDailyBudget>[0]> = {},
) =>
  allocateDailyBudget({
    dailyMinutes: 40,
    primaryShare: 80,
    spent: { PRIMARY: 0, FOUNDATION: 0 },
    candidates,
    ...overrides,
  });

describe('shared daily allocation', () => {
  it('protects primary new learning while foundation reviews accumulate', () => {
    const result = allocate([
      ...Array.from({ length: 20 }, (_, index) =>
        work(`review${index}`, 'FOUNDATION', 'REVIEW'),
      ),
      ...Array.from({ length: 4 }, (_, index) =>
        work(`new${index}`, 'PRIMARY', 'LEARN'),
      ),
    ]);
    expect(
      result.selected.filter((item) => item.group === 'PRIMARY'),
    ).toHaveLength(4);
    expect(
      result.selected.filter((item) => item.group === 'FOUNDATION'),
    ).toHaveLength(2);
    expect(result.allocation.remainingMinutes).toBe(0);
  });

  it.each(['PRIMARY', 'FOUNDATION'] as const)(
    'lends all unused time to %s, including a paused other group',
    (group) => {
      const result = allocate(
        Array.from({ length: 20 }, (_, index) =>
          work(`${index}`, group, 'REVIEW'),
        ),
      );
      expect(result.selected).toHaveLength(10);
    },
  );

  it('accounts for manual activity, completed work and reservations before issuing tasks', () => {
    const result = allocate(
      [work('p', 'PRIMARY', 'LEARN'), work('f', 'FOUNDATION', 'REVIEW')],
      { spent: { PRIMARY: 30, FOUNDATION: 5 } },
    );
    expect(result.selected.map((item) => item.id)).toEqual(['f']);
    expect(result.allocation.remainingMinutes).toBe(1);
  });

  it('budget reduction below spent time never issues another task', () => {
    const result = allocate([work('review', 'PRIMARY', 'REVIEW')], {
      dailyMinutes: 10,
      spent: { PRIMARY: 12, FOUNDATION: 3 },
    });
    expect(result.selected).toHaveLength(0);
    expect(result.allocation.overrunMinutes).toBe(5);
  });

  it('does not force oversized work, and applies reviews before new within each pool', () => {
    expect(
      allocate([work('weak', 'PRIMARY', 'REVIEW', 6)], { dailyMinutes: 5 })
        .selected,
    ).toEqual([]);
    expect(
      allocate(
        [work('new', 'PRIMARY', 'LEARN'), work('review', 'PRIMARY', 'REVIEW')],
        { dailyMinutes: 8 },
      ).selected.map((item) => item.id),
    ).toEqual(['review']);
  });
});
