import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import {
  PrismaClient,
  type GrammarPoint,
  type GrammarExample,
  type GrammarRelationGroup,
  type TrainingScenario,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  grammarSource,
  exampleSource,
  relationSource,
  scenarioSource,
} from '../../src/content-localization/content-source';
export const args = process.argv.slice(2);
export function arg(name: string, fallback = '') {
  return args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
}
export function database() {
  if (!process.env.DATABASE_URL) throw Error('DATABASE_URL_REQUIRED');
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
}
export async function readSources(db: PrismaClient) {
  const path = arg('--source');
  const data = path
    ? (JSON.parse(await readFile(path, 'utf8')) as {
        GrammarPoint: GrammarPoint[];
        GrammarExample: GrammarExample[];
        GrammarRelationGroup: GrammarRelationGroup[];
        TrainingScenario: TrainingScenario[];
      })
    : {
        GrammarPoint: await db.grammarPoint.findMany({
          where: { status: 'PUBLISHED' },
          orderBy: { id: 'asc' },
        }),
        GrammarExample: await db.grammarExample.findMany({
          where: { grammar: { status: 'PUBLISHED' } },
          orderBy: { id: 'asc' },
        }),
        GrammarRelationGroup: await db.grammarRelationGroup.findMany({
          orderBy: { id: 'asc' },
        }),
        TrainingScenario: await db.trainingScenario.findMany({
          where: { active: true },
          orderBy: { id: 'asc' },
        }),
      };
  return [
    ...data.GrammarPoint.map(grammarSource),
    ...data.GrammarExample.map(exampleSource),
    ...data.GrammarRelationGroup.map(relationSource),
    ...data.TrainingScenario.map(scenarioSource),
  ];
}
export async function jsonLines(path: string): Promise<unknown[]> {
  try {
    return (await readFile(path, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((s) => JSON.parse(s) as unknown);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}
export async function writeJson(path: string, value: unknown) {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n');
}
