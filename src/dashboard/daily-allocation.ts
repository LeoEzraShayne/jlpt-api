/** Shared deterministic policy for today's tasks and forecast simulation. */
export type BudgetGroup = 'PRIMARY' | 'FOUNDATION';
export interface AllocationCandidate {
  id: string;
  planId: string;
  group: BudgetGroup;
  type: 'REVIEW' | 'LEARN';
  minutes: number;
}

export function allocateDailyBudget<T extends AllocationCandidate>(input: {
  dailyMinutes: number;
  primaryShare: number;
  spent: Record<BudgetGroup, number>;
  candidates: T[];
}) {
  // Legacy time settings are accepted for older clients, but never cap tasks.
  // Callers already enforce each plan's daily new-grammar limit.
  const spentMinutes = input.spent.PRIMARY + input.spent.FOUNDATION;
  const selected: T[] = [];
  const selectedIds = new Set<string>();
  const used = { PRIMARY: 0, FOUNDATION: 0 };
  const ordered = [
    ...input.candidates.filter((item) => item.type === 'REVIEW'),
    ...input.candidates.filter((item) => item.type === 'LEARN'),
  ];
  for (const item of ordered) {
    if (selectedIds.has(item.id)) continue;
    selected.push(item);
    selectedIds.add(item.id);
    used[item.group] += Math.max(0, item.minutes);
  }
  return {
    selected,
    allocation: {
      timeLimited: false,
      primaryMinutes: 0,
      foundationMinutes: 0,
      spentMinutes,
      remainingMinutes: 0,
      overrunMinutes: 0,
      primaryPlannedMinutes: used.PRIMARY,
      foundationPlannedMinutes: used.FOUNDATION,
    },
  };
}

export function budgetGroup(
  level: string | undefined | null,
  primary: string,
): BudgetGroup {
  return !level || level === primary ? 'PRIMARY' : 'FOUNDATION';
}
