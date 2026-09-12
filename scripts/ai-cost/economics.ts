/** Recomputable paid-price scenarios, NOT a launch approval. No live FX assumptions. */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  paidCost,
  type FullUsage,
  type UsageProvider,
} from '../../src/ai/usage-cost';
type Usage = FullUsage & {
  model: string;
  provider: UsageProvider;
  purpose: string;
  success: boolean;
  costUsd: string | number | null;
  errorCode: string | null;
  createdAt: string;
};
const selectedTag = process.argv
  .find((v) => v.startsWith('--run-tag='))
  ?.slice(10);
if (selectedTag && !/^[a-z0-9-]+$/.test(selectedTag))
  throw Error('Invalid run tag');
const mixed = process.argv.includes('--mixed');
if (mixed && selectedTag)
  throw Error('Use either a measured run or mixed historical projection');
const sourceTags = mixed
  ? ['thinking-low-v1', 'bounded-repair-v6']
  : selectedTag
    ? [selectedTag]
    : [];
const files = sourceTags.length
  ? sourceTags.map((t) => `usage-${t}.json`)
  : [
      'usage-initial.json',
      'usage-gemini-server-initial.json',
      'usage-gemini31-v2.json',
    ];
const all = files.flatMap((f, index) => {
  const rows = JSON.parse(
    readFileSync(`scripts/ai-cost/${f}`, 'utf8'),
  ) as Usage[];
  return mixed
    ? rows.filter((u) =>
        index === 0
          ? u.purpose === 'GRAMMAR_REVIEW'
          : u.purpose !== 'GRAMMAR_REVIEW',
      )
    : rows;
});
const currencies = { USD: 1, JPY: 150, CNY: 7.2 }; // Scenario inputs, not live market quotes.
const fees = { stripeJapanCard: 0.036, climate: 0.01, fxConversion: 0.02 };
const serverMonthlyCny = 40;
const workersMonthlyUsd = 5;
const unverifiedExtrasMonthlyUsd: number | null = null;
const products = [
  {
    product: 'USD launch year',
    currency: 'USD',
    price: 64,
    days: 365,
    fx: true,
  },
  {
    product: 'USD standard year',
    currency: 'USD',
    price: 99.99,
    days: 365,
    fx: true,
  },
  { product: 'JPY year', currency: 'JPY', price: 6400, days: 365, fx: false },
  { product: 'USD day', currency: 'USD', price: 0.99, days: 1, fx: true },
  { product: 'JPY day', currency: 'JPY', price: 100, days: 1, fx: false },
];
// First DeepSeek corpus: 2 grammar false positives and English-answer task are
// rejected even though JSON schema passed. This is still not expert certification.
const humanAccepted: Record<string, number> = sourceTags.length
  ? {}
  : {
      'deepseek-flash:GRAMMAR_REVIEW': 10,
      'deepseek-flash:VOCABULARY_GENERATE': 2,
    };
if (sourceTags.length) {
  for (const row of all) humanAccepted[`${row.model}:${row.purpose}`] = 0;
  for (const tag of sourceTags) {
    const result = JSON.parse(
      readFileSync(`scripts/ai-cost/results-${tag}.json`, 'utf8'),
    ) as {
      runId: string;
      rows: Array<{
        model: string;
        id: string;
        locale: string;
        result?: { passed?: boolean };
      }>;
    };
    for (const row of result.rows) {
      if (row.result?.passed !== true) continue;
      const purpose = all.find(
        (u) =>
          (u as Usage & { taskKey: string }).taskKey ===
          `${result.runId}:${row.model}:${row.locale}:${row.id}`,
      )?.purpose;
      if (purpose) humanAccepted[`${row.model}:${purpose}`]++;
    }
  }
}
function stats(
  model: string,
  purpose: string,
  peak: boolean,
  coldCache: boolean,
) {
  const rows = all.filter((r) => r.model === model && r.purpose === purpose);
  const known = rows.filter((r) => r.costUsd !== null);
  const structuralSuccesses = rows.filter((r) => r.success).length;
  const accepted = humanAccepted[`${model}:${purpose}`] ?? structuralSuccesses;
  const sumKnown = known.reduce(
    (s, r) =>
      s +
      (paidCost(
        r.provider,
        r.model,
        { ...r, cachedInputTokens: coldCache ? null : r.cachedInputTokens },
        new Date(r.createdAt),
        peak,
      ) || 0),
    0,
  );
  return {
    calls: rows.length,
    structuralSuccesses,
    accepted,
    failedWithUsage: rows.filter((r) => !r.success && r.costUsd !== null)
      .length,
    unknownUsageCalls: rows.length - known.length,
    sumKnown,
    costPerAccepted: accepted ? sumKnown / accepted : null,
  };
}
const scenarios: Array<Record<string, unknown>> = [];
for (const model of [
  'deepseek-flash',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
])
  for (const peak of [false, true])
    for (const coldCache of [false, true]) {
      const grammar = stats(model, 'GRAMMAR_REVIEW', peak, coldCache),
        assessment = stats(model, 'VOCABULARY_ASSESS', peak, coldCache),
        generation = stats(model, 'VOCABULARY_GENERATE', peak, coldCache);
      for (const vocabularyShare of [0, 0.5, 1])
        for (const generationsPerVocabularyReview of [1 / 3, 1]) {
          if (
            grammar.costPerAccepted === null ||
            (vocabularyShare > 0 &&
              (assessment.costPerAccepted === null ||
                generation.costPerAccepted === null))
          )
            continue;
          const unit =
            (1 - vocabularyShare) * grammar.costPerAccepted +
            vocabularyShare *
              ((assessment.costPerAccepted ?? 0) +
                generationsPerVocabularyReview *
                  (generation.costPerAccepted ?? 0));
          // Max free allowance sensitivity: five tasks, three successful reviews each,
          // five generations if all vocabulary. This is not a new paid member cap.
          const freeAnnualCost =
            365 *
            ((1 - vocabularyShare) * 15 * grammar.costPerAccepted +
              vocabularyShare *
                (15 * (assessment.costPerAccepted ?? 0) +
                  5 * (generation.costPerAccepted ?? 0)));
          for (const correctionsPerDay of [20, 40, 120, 240])
            for (const product of products) {
              const exchange =
                currencies[product.currency as keyof typeof currencies];
              const grossUsd = product.price / exchange;
              const netUsd =
                grossUsd *
                (1 -
                  fees.stripeJapanCard -
                  fees.climate -
                  (product.fx ? fees.fxConversion : 0));
              const aiCostUsd = unit * correctionsPerDay * product.days;
              const contributionUsd = netUsd - aiCostUsd;
              const serverAnnualUsd =
                (serverMonthlyCny / currencies.CNY + workersMonthlyUsd) * 12;
              const freeUserRatios = [0, 1, 5, 10].map((freePerPaid) => {
                const annualContribution =
                  (contributionUsd * 365) / product.days -
                  freeAnnualCost * freePerPaid;
                return {
                  freePerPaid,
                  freeAnnualCostPerPaid: freeAnnualCost * freePerPaid,
                  breakevenPayingUsers:
                    annualContribution > 0
                      ? Math.ceil(serverAnnualUsd / annualContribution)
                      : null,
                  marginAt10UsersUsd:
                    contributionUsd -
                    ((serverAnnualUsd / 10 + freeAnnualCost * freePerPaid) *
                      product.days) /
                      365,
                  marginAt100UsersUsd:
                    contributionUsd -
                    ((serverAnnualUsd / 100 + freeAnnualCost * freePerPaid) *
                      product.days) /
                      365,
                };
              });
              scenarios.push({
                model,
                peak,
                coldCache,
                vocabularyShare,
                generationsPerVocabularyReview,
                correctionsPerDay,
                ...product,
                netUsd,
                aiCostUsd,
                contributionUsd,
                unitCostUsd: unit,
                freeUserRatios,
              });
            }
        }
    }
const output = {
  inputs: {
    files,
    selectedTag,
    mixedHistoricalProjection: mixed,
    sourceTags,
    successBasis: mixed
      ? 'Historical composition: thinking grammar plus disabled vocabulary; all selected failed/repair calls retained, not a new measured mixed run or qualification'
      : selectedTag
        ? 'Final operation expected assertions, all failed/repair attempt costs retained; independent semantic review pending'
        : 'Initial run plus documented human rejections',
    currencies,
    fees,
    serverMonthlyCny,
    workersMonthlyUsd,
    unverifiedExtrasMonthlyUsd,
    workersOverageFormula:
      'max(0,dynamicRequestsMillions-10)*0.30 + max(0,cpuMsMillions-30)*0.02 USD/month; static assets do not add request cost',
    fxSensitivity: { JPYperUSD: [130, 150, 170], CNYperUSD: [6.5, 7.2, 8] },
    taxTreatment:
      'Cash contribution excludes tax/refunds/acquisition; positive contribution is not net profit.',
    assumptions:
      'Standard paid rates despite free Gemini tier. Full server renewal quote, not past payment. Charged schema failures and known human-rejected examples counted. Unknown cost never assumed zero: scenarios are known-cost lower bounds. Peak overrides DeepSeek time-of-day and cold-cache sensitivity removes cache discounts. Existing default models remain unchanged.',
  },
  measurements: [
    'deepseek-flash',
    'gemini-3.5-flash',
    'gemini-3.1-flash-lite',
  ].map((model) => ({
    model,
    grammar: stats(model, 'GRAMMAR_REVIEW', true, true),
    assessment: stats(model, 'VOCABULARY_ASSESS', true, true),
    generation: stats(model, 'VOCABULARY_GENERATE', true, true),
  })),
  scenarios,
};
writeFileSync(
  `scripts/ai-cost/economics${mixed ? '-mixed-history-v1' : selectedTag ? '-' + selectedTag : ''}.json`,
  JSON.stringify(output, null, 2),
);
console.log(
  JSON.stringify(
    {
      measurements: output.measurements,
      examples: scenarios.filter(
        (s) =>
          s.peak &&
          s.coldCache &&
          s.model === 'deepseek-flash' &&
          s.vocabularyShare === 0.5 &&
          s.generationsPerVocabularyReview === 1 &&
          s.days === 365,
      ),
    },
    null,
    2,
  ),
);
