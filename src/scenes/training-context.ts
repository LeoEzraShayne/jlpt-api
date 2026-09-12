import { z } from 'zod';

const localizedSchema = z.object({
  requestedLocale: z.enum(['zh', 'en']),
  resolvedLocale: z.enum(['zh', 'en']).nullable(),
  status: z.enum(['ORIGINAL', 'VALIDATED', 'MISSING', 'STALE']),
  sourceHash: z.string(),
  fields: z.record(z.string(), z.string().nullable()).nullable(),
});

export const scenarioSchema = z.object({
  version: z.literal('scenario-v1'),
  id: z.string(),
  scenarioId: z.string(),
  taskId: z.string(),
  objectiveId: z.string(),
  domain: z.string(),
  objective: z.string(),
  register: z.string(),
  promptZh: z.string(),
  localized: localizedSchema.optional(),
});
const wordSchema = z.object({
  id: z.string(),
  word: z.string(),
  reading: z.string(),
  chineseGloss: z.string().nullable(),
  chineseGlossSource: z.string().nullable().optional(),
  glosses: z.unknown(),
  sourceName: z.string(),
  sourceVersion: z.string(),
});
const expressionSchema = z.object({
  id: z.string(),
  sentence: z.string(),
  furigana: z.string().nullable(),
  translationZh: z.string().nullable(),
  provenance: z.unknown(),
});
const phraseSchema = z.object({
  id: z.string(),
  word: z.string(),
  reading: z.string(),
  payload: z.unknown(),
});
export const trainingContextSchema = z.object({
  version: z.literal('training-v1'),
  selectionVersion: z.string().optional(),
  instructionZh: z.string(),
  instruction: z.string().optional(),
  explanationLocale: z.enum(['zh', 'en']).optional(),
  scenario: scenarioSchema.nullable(),
  words: z.array(wordSchema).max(2),
  supportingGrammar: z
    .object({
      id: z.string(),
      title: z.string(),
      level: z.string(),
    })
    .nullable(),
  expressions: z.array(expressionSchema).max(3),
  phrases: z.array(phraseSchema).max(3),
});
export type TrainingContext = z.infer<typeof trainingContextSchema>;
export function readTrainingContext(value: unknown) {
  const result = trainingContextSchema.safeParse(value);
  return result.success ? result.data : null;
}

// Whitelisting protects future server-only reference fields as well as current ones.
export function publicTrainingContext(value: unknown, hidden: boolean) {
  const context = readTrainingContext(value);
  if (!context) return null;
  return {
    ...context,
    expressions: hidden
      ? context.expressions.map(({ id }) => ({ id, hidden: true }))
      : context.expressions,
    phrases: hidden
      ? context.phrases.map(({ id }) => ({ id, hidden: true }))
      : context.phrases,
    referenceHidden: hidden,
  };
}
export function presentSession<T extends object>(session: T, revealed = false) {
  const data = session as T & {
    mode?: string;
    trainingContext?: unknown;
    grammar?: object;
  };
  const hidden = data.mode === 'REVIEW' && !revealed;
  return {
    ...session,
    ...(data.trainingContext !== undefined
      ? {
          trainingContext: publicTrainingContext(data.trainingContext, hidden),
        }
      : {}),
    ...(data.grammar ? { grammar: presentGrammar(data.grammar, hidden) } : {}),
  };
}
export function presentGrammar<T extends object>(grammar: T, hidden: boolean) {
  if (!hidden) return grammar;
  return {
    ...grammar,
    examples: [],
    chineseExplanation: '',
    localized: null,
    connectionRule: null,
    usageScene: null,
    commonErrors: null,
    relationMembers: [],
  };
}
