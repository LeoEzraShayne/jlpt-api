import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { z } from 'zod';
import { fingerprint } from '../../src/content/content-fingerprint';

const entrySchema = z.object({
  word: z.string().min(1),
  reading: z.string().min(1),
  senseKey: z.string().min(1),
  partOfSpeech: z.array(z.string()),
  glosses: z
    .array(
      z.object({
        language: z.string(),
        text: z.string(),
        type: z.string().nullable().optional(),
      }),
    )
    .min(1),
  level: z.enum(['N1', 'N2', 'N3', 'N4']),
  levelSource: z.string().min(1),
  sourceName: z.literal('JMdict/EDRDG'),
  sourceUrl: z.string().url(),
  sourceVersion: z.string().min(1),
  sourceEntryId: z.string().min(1),
  license: z.literal('CC-BY-SA-4.0'),
  provenance: z.object({
    dictionarySha256: z.string().length(64),
    mappingRevision: z.string().min(7),
    mappingUrl: z.string().url(),
    mappingLicense: z.string(),
    originalLevelSource: z.string().url(),
    originalLevelLicense: z.string(),
    dictionaryLicenseUrl: z.string().url(),
    levelIsOfficial: z.literal(false),
    frequencyRank: z.null(),
  }),
});
const documentSchema = z.object({
  format: z.literal('jlpt-reference-v1'),
  license: z.literal('CC-BY-SA-4.0'),
  attribution: z.string().min(1),
  entries: z.array(entrySchema).min(1),
});

async function main() {
  const path = process.argv[2];
  if (!path)
    throw new Error(
      'Usage: tsx scripts/content/import-reference.ts file.json [--commit]',
    );
  const document = documentSchema.parse(
    JSON.parse(await readFile(path, 'utf8')),
  );
  if (!process.argv.includes('--commit')) {
    console.log(
      JSON.stringify({
        valid: true,
        senses: document.entries.length,
        committed: false,
        license: document.license,
        attribution: document.attribution,
      }),
    );
    return;
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL required for --commit');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    let count = 0;
    for (const entry of document.entries) {
      const hash = fingerprint([
        'PUBLIC',
        entry.sourceName,
        entry.sourceEntryId,
        entry.word,
        entry.reading,
        entry.senseKey,
      ]);
      const data = {
        ...entry,
        glosses: entry.glosses as Prisma.InputJsonValue,
        provenance: {
          ...entry.provenance,
          attribution: document.attribution,
        } as Prisma.InputJsonValue,
        validationStatus: 'VALIDATED',
      };
      await db.vocabularyEntry.upsert({
        where: { fingerprint: hash },
        create: { ...data, fingerprint: hash },
        update: data,
      });
      count += 1;
    }
    console.log(
      JSON.stringify({
        committed: true,
        senses: count,
        levelClassification: 'REFERENCE_NOT_OFFICIAL',
      }),
    );
  } finally {
    await db.$disconnect();
  }
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Import failed');
  process.exitCode = 1;
});
