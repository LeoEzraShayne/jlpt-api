/** Materialize the exact existing practice catalog before translating future sessions. */
import { readFile } from 'node:fs/promises';
import type { GrammarPoint, Prisma, TrainingScenario } from '@prisma/client';
import {
  practiceProfile,
  PRACTICE_SELECTION_VERSION,
} from '../../src/scenes/grammar-practice-catalog';
import { database, arg, args, writeJson } from './io';
async function main() {
  const db = database();
  try {
    const input = arg('--source');
    const snapshot = input
      ? (JSON.parse(await readFile(input, 'utf8')) as {
          GrammarPoint: GrammarPoint[];
          TrainingScenario: TrainingScenario[];
        })
      : null;
    const grammars =
      snapshot?.GrammarPoint ??
      (await db.grammarPoint.findMany({ where: { status: 'PUBLISHED' } }));
    const scenarios = grammars.flatMap((g) => {
      const profile = practiceProfile(g.title);
      return profile
        ? profile.tasks.map((task): Prisma.TrainingScenarioCreateInput => ({
            id: `${PRACTICE_SELECTION_VERSION}:${g.id}:${task.objective}`,
            domain: profile.domain,
            objective: task.objective,
            register: profile.register,
            promptZh: task.promptZh,
            levels: [g.level],
            active: true,
            version: 'scenario-v1',
          }))
        : [];
    });
    if (snapshot && arg('--output')) {
      const byId = new Map(snapshot.TrainingScenario.map((s) => [s.id, s]));
      for (const row of scenarios) byId.set(row.id, row as TrainingScenario);
      await writeJson(arg('--output'), {
        ...snapshot,
        TrainingScenario: [...byId.values()],
      });
    }
    console.log(
      JSON.stringify({
        catalogScenarios: scenarios.length,
        commit: args.includes('--commit'),
      }),
    );
    if (!args.includes('--commit')) return;
    if (snapshot) throw Error('COMMIT_REQUIRES_LIVE_DATABASE');
    await db.$transaction(
      scenarios.map((s) =>
        db.trainingScenario.upsert({
          where: { id: s.id },
          create: s,
          update: s,
        }),
      ),
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error('SCENARIO_PREPARATION_FAILED');
  process.exitCode = 1;
});
