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

describe('daily scheduling without time caps', () => {
  it('includes all due foundation reviews and the supplied primary new-learning allowance', () => {
    const result = allocate([
      ...Array.from({ length: 20 }, (_, i) =>
        work(`review${i}`, 'FOUNDATION', 'REVIEW'),
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        work(`new${i}`, 'PRIMARY', 'LEARN'),
      ),
    ]);
    expect(result.selected).toHaveLength(24);
    expect(result.allocation.foundationPlannedMinutes).toBe(80);
    expect(result.allocation.primaryPlannedMinutes).toBe(32);
    expect(result.allocation.timeLimited).toBe(false);
  });

  it.each([0, 5, 120])(
    'keeps 15 due reviews after exceeding the legacy %s minute setting',
    (dailyMinutes) => {
      const result = allocate(
        Array.from({ length: 15 }, (_, i) => work(`${i}`, 'PRIMARY', 'REVIEW')),
        { dailyMinutes, spent: { PRIMARY: 121.65, FOUNDATION: 0 } },
      );
      expect(result.selected).toHaveLength(15);
      expect(result.allocation.spentMinutes).toBe(121.65);
      expect(result.allocation.overrunMinutes).toBe(0);
    },
  );

  it('ignores the old split, keeps reviews before new work, and deduplicates candidate IDs', () => {
    const candidates = [
      work('new', 'PRIMARY', 'LEARN'),
      work('review', 'FOUNDATION', 'REVIEW'),
    ];
    const first = allocate([...candidates, candidates[1]], {
      primaryShare: 100,
    });
    const second = allocate(candidates, { primaryShare: 0 });
    expect(first.selected.map((item) => item.id)).toEqual(['review', 'new']);
    expect(first.selected).toEqual(second.selected);
  });
});
