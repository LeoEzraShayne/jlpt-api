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
  const budget = Math.max(0, input.dailyMinutes);
  const primaryMinutes =
    (budget * Math.max(0, Math.min(100, input.primaryShare))) / 100;
  const foundationMinutes = budget - primaryMinutes;
  const spentMinutes = input.spent.PRIMARY + input.spent.FOUNDATION;
  let remaining = Math.max(0, budget - spentMinutes);
  const selected: T[] = [];
  const selectedIds = new Set<string>();
  const used = { PRIMARY: 0, FOUNDATION: 0 };
  const ordered = [
    ...input.candidates.filter((item) => item.type === 'REVIEW'),
    ...input.candidates.filter((item) => item.type === 'LEARN'),
  ];
  function fill(group: BudgetGroup, available: number) {
    let allowance = Math.min(remaining, Math.max(0, available));
    for (const item of ordered) {
      if (item.group !== group || selectedIds.has(item.id)) continue;
      if (item.minutes <= 0 || item.minutes > allowance) continue;
      selected.push(item);
      selectedIds.add(item.id);
      used[group] += item.minutes;
      allowance -= item.minutes;
      remaining -= item.minutes;
    }
  }
  fill('PRIMARY', primaryMinutes - input.spent.PRIMARY);
  fill('FOUNDATION', foundationMinutes - input.spent.FOUNDATION);
  // The two groups have first claim on their own shares. Only unused time is lent.
  fill('PRIMARY', remaining);
  fill('FOUNDATION', remaining);
  return {
    selected,
    allocation: {
      primaryMinutes,
      foundationMinutes,
      spentMinutes,
      remainingMinutes: remaining,
      overrunMinutes: Math.max(0, spentMinutes - budget),
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
