import { createHash } from 'node:crypto';

export type ContentEntityType = 'GRAMMAR' | 'EXAMPLE' | 'RELATION' | 'SCENARIO';
export type TextFields = Record<string, string | null>;
export interface ContentSource {
  entityType: ContentEntityType;
  entityId: string;
  sourceHash: string;
  fields: TextFields;
  context: TextFields;
}
export function source(
  entityType: ContentEntityType,
  entityId: string,
  fields: TextFields,
  context: TextFields = {},
): ContentSource {
  const canonical = (value: TextFields) =>
    Object.keys(value)
      .sort()
      .map((key) => [key, value[key]]);
  const sourceHash = createHash('sha256')
    .update(JSON.stringify([entityType, canonical(fields), canonical(context)]))
    .digest('hex');
  return { entityType, entityId, sourceHash, fields, context };
}
export function grammarSource(g: {
  id: string;
  title: string;
  chineseExplanation: string;
  connectionRule?: string | null;
  usageScene?: string | null;
  commonErrors?: string | null;
}) {
  return source(
    'GRAMMAR',
    g.id,
    {
      explanation: g.chineseExplanation,
      connectionRule: g.connectionRule ?? null,
      usageScene: g.usageScene ?? null,
      commonErrors: g.commonErrors ?? null,
    },
    { title: g.title },
  );
}
export function exampleSource(e: {
  id: string;
  sentence: string;
  translation: string;
}) {
  return source(
    'EXAMPLE',
    e.id,
    { translation: e.translation },
    { sentence: e.sentence },
  );
}
export function relationSource(g: {
  id: string;
  title: string;
  notes: string;
}) {
  return source('RELATION', g.id, { title: g.title, notes: g.notes });
}
export function scenarioSource(s: {
  id: string;
  domain: string;
  objective: string;
  register: string;
  promptZh: string;
}) {
  return source('SCENARIO', s.id, {
    domain: s.domain,
    objective: s.objective,
    register: s.register,
    prompt: s.promptZh,
  });
}
