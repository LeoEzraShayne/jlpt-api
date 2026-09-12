/** Finite operation success and complete attempt cost; never erase first failures. */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  paidCost,
  type FullUsage,
  type UsageProvider,
} from '../../src/ai/usage-cost';
type Usage = FullUsage & {
  purpose: string;
  provider: UsageProvider;
  model: string;
  requestId: string;
  taskKey: string;
  attempt: number;
  success: boolean;
  costUsd: string | null;
  createdAt: string;
  errorCode: string | null;
};
type Outcome = {
  model: string;
  id: string;
  locale: string;
  error?: string;
  skipped?: string;
  result?: { passed?: boolean };
};
const tag = process.argv.find((v) => v.startsWith('--tag='))?.slice(6);
if (!tag || !/^[a-z0-9-]+$/.test(tag)) throw Error('Safe run tag required');
const { runId, rows } = JSON.parse(
  readFileSync(`scripts/ai-cost/results-${tag}.json`, 'utf8'),
) as { runId: string; rows: Outcome[] };
const usage = JSON.parse(
  readFileSync(`scripts/ai-cost/usage-${tag}.json`, 'utf8'),
) as Usage[];
const groups = rows.map((row) => ({
  row,
  calls: usage.filter(
    (u) => u.taskKey === `${runId}:${row.model}:${row.locale}:${row.id}`,
  ),
}));
const sum = (rows: Usage[]) =>
  rows.reduce((s, u) => s + Number(u.costUsd ?? 0), 0);
const peakCold = (rows: Usage[]) =>
  rows.reduce(
    (s, u) =>
      s +
      (paidCost(
        u.provider,
        u.model,
        { ...u, cachedInputTokens: null },
        new Date(u.createdAt),
        true,
      ) ?? 0),
    0,
  );
const report = {
  tag,
  runId,
  operations: rows.length,
  networkCalls: usage.length,
  firstCandidateFailures: groups.filter(
    (g) => g.calls[0] && !g.calls[0].success,
  ).length,
  firstCandidateFailureRate:
    groups.filter((g) => g.calls[0] && !g.calls[0].success).length /
    rows.length,
  repairOperations: groups.filter((g) => g.calls.length === 2).length,
  structurallyRecovered: groups.filter(
    (g) => g.calls.length === 2 && g.calls[1].success,
  ).length,
  finalStructuralSuccesses: rows.filter((r) => r.result).length,
  finalExpectedAssertionsPassed: rows.filter((r) => r.result?.passed === true)
    .length,
  finalOperationErrors: rows
    .filter((r) => r.error)
    .map((r) => ({ id: r.id, locale: r.locale, error: r.error })),
  semanticAssertionFailures: rows
    .filter((r) => r.result?.passed === false)
    .map((r) => ({ id: r.id, locale: r.locale })),
  unknownCostCalls: usage.filter((u) => u.costUsd === null).length,
  allAttemptsPaidEstimateUsd: sum(usage),
  allAttemptsPeakColdEstimateUsd: peakCold(usage),
  perPurpose: [
    'GRAMMAR_REVIEW',
    'VOCABULARY_ASSESS',
    'VOCABULARY_GENERATE',
  ].map((purpose) => {
    const jobs = groups.filter((g) => g.calls[0]?.purpose === purpose),
      calls = jobs.flatMap((g) => g.calls),
      successful = jobs.filter((g) => g.row.result?.passed === true).length;
    return {
      purpose,
      operations: jobs.length,
      firstCandidateFailures: jobs.filter((g) => !g.calls[0].success).length,
      finalExpectedAssertionsPassed: successful,
      networkCalls: calls.length,
      failedCalls: calls.filter((c) => !c.success).length,
      paidCostAllAttemptsUsd: sum(calls),
      paidCostPerSuccessfulOperationUsd: successful
        ? sum(calls) / successful
        : null,
      peakColdCostPerSuccessfulOperationUsd: successful
        ? peakCold(calls) / successful
        : null,
    };
  }),
  limits: {
    callsPerRound: 2,
    repairCallsPerRound: 1,
    grammarWorkerRounds: 3,
    grammarCallsAcrossWorkerRounds: 6,
    vocabularyCallsPerGenerationOrAssessment: 2,
  },
  qualification:
    'Automatic expected assertions and schema success are not independent semantic acceptance. Cold-cache and peak scenarios are synthetic stress estimates. Unknown cost is not zero.',
};
writeFileSync(
  `scripts/ai-cost/repair-report-${tag}.json`,
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
