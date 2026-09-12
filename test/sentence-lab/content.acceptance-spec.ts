import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  GrammarPoint,
  GrammarExample,
  GrammarRelationGroup,
  TrainingScenario,
} from '@prisma/client';
import { acceptanceDatabase, type AcceptanceDatabase } from './database';
import { ContentLocalizationService } from '../../src/content-localization/content-localization.service';
import type { PrismaService } from '../../src/database/prisma.service';
import {
  grammarSource,
  exampleSource,
  relationSource,
  scenarioSource,
} from '../../src/content-localization/content-source';
import { presentSession } from '../../src/scenes/training-context';
import {
  validateArtifact,
  type TranslationArtifact,
} from '../../src/content-localization/translation-validation';
let h: AcceptanceDatabase;
let localization: ContentLocalizationService;
let rows: TranslationArtifact[];
const run = promisify(execFile);
async function cli(script: string, args: string[] = []) {
  return run(
    process.execPath,
    ['--import', 'tsx', `scripts/content-localization/${script}`, ...args],
    {
      env: {
        ...process.env,
        DATABASE_URL: h.connectionString,
        DOTENV_CONFIG_PATH: '/dev/null',
      },
      timeout: 60000,
    },
  );
}
beforeAll(async () => {
  if (!process.env.ACCEPTANCE_STATIC_SNAPSHOT)
    throw new Error(
      'ACCEPTANCE_STATIC_SNAPSHOT_REQUIRED: provide the public four-table source snapshot',
    );
  const snapshot = JSON.parse(
    await readFile(process.env.ACCEPTANCE_STATIC_SNAPSHOT, 'utf8'),
  ) as {
    GrammarPoint: GrammarPoint[];
    GrammarExample: GrammarExample[];
    GrammarRelationGroup: GrammarRelationGroup[];
    TrainingScenario: TrainingScenario[];
  };
  h = await acceptanceDatabase();
  await h.prisma.grammarPoint.createMany({ data: snapshot.GrammarPoint });
  await h.prisma.grammarExample.createMany({ data: snapshot.GrammarExample });
  await h.prisma.grammarRelationGroup.createMany({
    data: snapshot.GrammarRelationGroup,
  });
  for (const s of snapshot.TrainingScenario) {
    const data = {
      ...s,
      levels:
        typeof s.levels === 'string'
          ? ((s.levels as string)
              .replace(/[{}]/g, '')
              .split(',') as TrainingScenario['levels'])
          : s.levels,
    };
    await h.prisma.trainingScenario.upsert({
      where: { id: s.id },
      create: data,
      update: data,
    });
  }
  await cli('prepare-scenarios.ts', ['--commit']);
  rows = (
    await readFile('scripts/content-localization/translations.en.jsonl', 'utf8')
  )
    .trim()
    .split('\n')
    .map((s) => JSON.parse(s) as TranslationArtifact);
  await cli('manage.ts', ['--apply', '--commit']);
  localization = new ContentLocalizationService(h.prisma as PrismaService);
}, 120000);
afterAll(async () => {
  await h?.stop();
});

test('all 546 English entries correspond to current real source IDs and hashes', async () => {
  const grammar = await h.prisma.grammarPoint.findMany();
  const examples = await h.prisma.grammarExample.findMany();
  const relations = await h.prisma.grammarRelationGroup.findMany();
  const scenarios = await h.prisma.trainingScenario.findMany();
  expect([
    grammar.length,
    examples.length,
    relations.length,
    scenarios.length,
  ]).toEqual([223, 223, 6, 94]);
  const sources = [
    ...grammar.map(grammarSource),
    ...examples.map(exampleSource),
    ...relations.map(relationSource),
    ...scenarios.map(scenarioSource),
  ];
  expect(rows).toHaveLength(546);
  expect(
    new Set(
      rows.map(
        (r) => `${r.entityType}:${r.entityId}:${r.locale}:${r.sourceHash}`,
      ),
    ).size,
  ).toBe(546);
  for (const source of sources) {
    const row = rows.find(
      (r) =>
        r.entityType === source.entityType && r.entityId === source.entityId,
    )!;
    expect(row).toBeDefined();
    expect(() => validateArtifact(source, row)).not.toThrow();
  }
  const resolved = await localization.resolveMany(sources, 'en');
  expect(
    [...resolved.values()].every(
      (r) => r.status === 'VALIDATED' && r.resolvedLocale === 'en',
    ),
  ).toBe(true);
});

test('running the actual import twice preserves 546 rows and Japanese/Chinese originals', async () => {
  const before = await h.prisma.grammarPoint.findMany({
    include: { examples: true },
    orderBy: { id: 'asc' },
  });
  await cli('manage.ts', ['--apply', '--commit']);
  expect(await h.prisma.contentTranslation.count()).toBe(546);
  expect(
    await h.prisma.grammarPoint.findMany({
      include: { examples: true },
      orderBy: { id: 'asc' },
    }),
  ).toEqual(before);
  const translated = await localization.grammar(before, 'en');
  for (let i = 0; i < before.length; i++) {
    expect(translated[i].title).toBe(before[i].title);
    expect(translated[i].chineseExplanation).toBe(before[i].chineseExplanation);
    expect(
      translated[i].examples.map((e) => [
        e.sentence,
        e.furigana,
        e.translation,
      ]),
    ).toEqual(before[i].examples.map((e) => [e.sentence, e.translation]));
  }
});

test('hidden review response redacts both languages and reference examples until reveal', async () => {
  const grammar = await h.prisma.grammarPoint.findFirstOrThrow({
    include: { examples: true },
  });
  const [localized] = await localization.grammar([grammar], 'en');
  const hidden = presentSession({ mode: 'REVIEW', grammar: localized });
  expect(hidden.grammar).toMatchObject({
    examples: [],
    localized: null,
    chineseExplanation: '',
    connectionRule: null,
    usageScene: null,
    commonErrors: null,
    relationMembers: [],
  });
  const revealed = presentSession({ mode: 'REVIEW', grammar: localized }, true);
  expect(revealed.grammar).toEqual(localized);
});

test('source mutation and Japanese example mutation reject stale English without fallback', async () => {
  const original = await h.prisma.grammarPoint.findFirstOrThrow({
    include: { examples: true },
  });
  await expect(
    h.prisma.$transaction(async (db) => {
      const changed = await db.grammarPoint.update({
        where: { id: original.id },
        data: { chineseExplanation: original.chineseExplanation + '验收变更' },
      });
      const service = new ContentLocalizationService(db as PrismaService);
      const [view] = await service.grammar([changed], 'en');
      expect(view.localized).toMatchObject({
        status: 'STALE',
        resolvedLocale: null,
        fields: null,
      });
      const example = original.examples[0];
      const changedExample = await db.grammarExample.update({
        where: { id: example.id },
        data: { sentence: example.sentence + '。' },
      });
      const examples = await service.resolveMany(
        [exampleSource(changedExample)],
        'en',
      );
      expect(examples.get(`EXAMPLE:${example.id}`)).toMatchObject({
        status: 'STALE',
        resolvedLocale: null,
        fields: null,
      });
      throw new Error('EXPECTED_TEST_ROLLBACK');
    }),
  ).rejects.toThrow('EXPECTED_TEST_ROLLBACK');
  expect(
    await h.prisma.grammarPoint.findUniqueOrThrow({
      where: { id: original.id },
      include: { examples: true },
    }),
  ).toEqual(original);
});
