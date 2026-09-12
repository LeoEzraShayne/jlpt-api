/** Reproduce the reviewed artifact from the original public production snapshot. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseGrammarText } from '../../../src/imports/grammar-parser';
import {
  grammarSource,
  exampleSource,
  relationSource,
} from '../../../src/content-localization/content-source';
import { translationSchema } from '../../../src/content-localization/translation-validation';

const sha = (value: Record<string, unknown>) =>
  createHash('sha256')
    .update(
      JSON.stringify(
        Object.keys(value)
          .sort()
          .map((k) => [k, value[k]]),
      ),
    )
    .digest('hex');
const refs = {
  mai: 'https://kotobank.jp/word/%E3%81%BE%E3%81%84-632809',
  nhk: 'https://www.jstage.jst.go.jp/article/bunken/68/12/68_46/_pdf/-char/en',
  nishitemo: 'https://jn1et.com/nisiro-nisiro/',
  wake: 'https://mainichi-nonbiri.com/grammar/n3-wakenihaikanai/',
};
async function main() {
  const snapshot = JSON.parse(
    await readFile(process.argv[2], 'utf8'),
  ) as Record<string, Record<string, unknown>[]>;
  const path = 'data/N1-N5语法总结-有解释例句.txt';
  let text = await readFile(path, 'utf8');
  const changes = [
    {
      id: 'cmsldfdu70047y1vb3tqhdqss',
      issue: 'F-L01',
      fields: {
        connectionRule:
          '同一动词的意志形＋か＋辞书形＋まいか，如行こうか行くまいか。五段动词用辞书形＋まい，不用あ段。一段动词也可去掉「る」＋まい，如食べようか食べまいか／食べようか食べるまいか。する可用しまい／すまい／するまい；来る可用こまい／くるまい。',
      },
      refs: [refs.mai, refs.nhk],
    },
    {
      id: 'cmsldfe3x007ly1vb0jpatf6r',
      issue: 'F-L02',
      fields: {
        connectionRule:
          '动词、イ形容词用普通形＋にしても，肯定、否定及过去形均可，如行くにしても行かないにしても。ナ形容词词干、名词可直接接にしても，也可接である＋にしても；其否定形、过去形用ではない／だった等，不接非过去肯定的「だ」。将两个选项分别接にしても并列。',
      },
      refs: [refs.nishitemo],
    },
    {
      id: 'cmsldfe5g008ny1vb9x5ctek9',
      issue: 'F-L04',
      fields: {
        chineseExplanation:
          '不能……；由于社会常识、责任或心理原因，不能做某事。本条说明肯定形式接续的用法。否定形式「Vない＋わけにはいかない」则表示不能不做、必须做，见「～ないわけにはいかない」。',
        connectionRule:
          '动词肯定非过去普通形＋わけにはいかない，如行くわけにはいかない；也可接「Vている」，如遊んでいるわけにはいかない。本条不将「Vない＋わけにはいかない」列为同义接续，后者表示必须做。',
      },
      refs: [refs.wake],
    },
  ];
  const sourcePatches: Record<string, unknown>[] = [];
  for (const change of changes) {
    const before = snapshot.GrammarPoint.find((r) => r.id === change.id)!;
    const anchor = `${String(before.sourceOrdinal)}. ${String(before.title)}\n`;
    const start = text.indexOf(anchor),
      end = text.indexOf('\n\n', start);
    if (start < 0 || end < 0) throw Error('SOURCE_TEXT_ANCHOR_MISSING');
    let block = text.slice(start, end);
    if ('chineseExplanation' in change.fields)
      block = block.replace(
        `中文解释：${String(before.chineseExplanation)}`,
        `中文解释：${change.fields.chineseExplanation}`,
      );
    if (block.includes('接续：')) throw Error('SOURCE_TEXT_ALREADY_HAS_RULE');
    block = block.replace(
      '\n例句：',
      `\n接续：${change.fields.connectionRule}\n例句：`,
    );
    text = text.slice(0, start) + block + text.slice(end);
    sourcePatches.push({
      table: 'GrammarPoint',
      issue: change.issue,
      before,
      after: { ...before, ...change.fields },
      references: change.refs,
    });
  }
  const e = snapshot.GrammarExample.find(
    (r) => r.id === 'cmsldfe5j008qy1vbndypnc0i',
  )!;
  const eAfter = {
    ...e,
    sentence: '上司に頼まれたので、引き受けないわけにはいかない。',
    translation: '上司拜托了，所以不能不接受。',
  };
  text = text.replace(
    `例句：${String(e.sentence)}\n译文：${String(e.translation)}`,
    `例句：${eAfter.sentence}\n译文：${eAfter.translation}`,
  );
  sourcePatches.push({
    table: 'GrammarExample',
    issue: 'F-L03',
    before: e,
    after: eAfter,
    references: [refs.wake],
  });
  const parent = snapshot.GrammarPoint.find((r) => r.id === e.grammarId)!;
  sourcePatches.push({
    table: 'GrammarPoint',
    issue: 'F-L03-parent-import-hash',
    before: parent,
    after: { ...parent },
    references: [refs.wake],
  });
  const parsed = parseGrammarText(text);
  if (parsed.issues.length) throw Error('SOURCE_TEXT_PARSE_FAILED');
  for (const patch of sourcePatches) {
    const before = patch.before as Record<string, unknown>,
      after = patch.after as Record<string, unknown>;
    if (patch.table === 'GrammarPoint')
      after.sourceHash = parsed.grammars.find(
        (r) => r.level === before.level && r.ordinal === before.sourceOrdinal,
      )!.sourceHash;
    // Timestamps are operational metadata, not content. Every other scalar is guarded.
    for (const row of [before, after]) {
      delete row.createdAt;
      delete row.updatedAt;
    }
    patch.beforeRecordHash = sha(before);
    patch.afterRecordHash = sha(after);
  }
  const currentPath = 'scripts/content-localization/translations.en.jsonl';
  const translations = (await readFile(currentPath, 'utf8'))
    .trim()
    .split('\n')
    .map((s) => translationSchema.parse(JSON.parse(s)));
  const translationEdits: Record<string, unknown>[] = [];
  const en: Record<string, Record<string, string>> = {
    cmsldfdu70047y1vb3tqhdqss: {
      connectionRule:
        'Use the same verb: volitional form + か + dictionary form + まいか, e.g. 行こうか行くまいか. Godan verbs take the dictionary form before まい, not the a-row form. Ichidan verbs may also drop る: 食べようか食べまいか / 食べようか食べるまいか. For する, use しまい / すまい / するまい; for 来る, use こまい / くるまい.',
    },
    cmsldfe3x007ly1vb0jpatf6r: {
      connectionRule:
        'Verbs and i-adjectives take the plain form + にしても, including affirmative, negative and past forms, e.g. 行くにしても行かないにしても. Na-adjective stems and nouns may take にしても directly or use である + にしても; their negative and past forms use ではない / だった, etc., without nonpast affirmative だ. Attach にしても to each of the two alternatives.',
    },
    cmsldfe5g008ny1vb9x5ctek9: {
      explanation:
        'Cannot do something because of social expectations, responsibility, or personal considerations. This entry covers affirmative forms before わけにはいかない. In contrast, Vない + わけにはいかない means cannot leave something undone / must do it; see the separate ～ないわけにはいかない entry.',
      connectionRule:
        'Affirmative nonpast plain form of a verb + わけにはいかない, e.g. 行くわけにはいかない. Vている can also precede it, e.g. 遊んでいるわけにはいかない. Vない + わけにはいかない has the opposite polarity, expressing an obligation to act, and is not an equivalent connection for this entry.',
    },
    cmsldfe5j008qy1vbndypnc0i: {
      translation: 'My boss asked me, so I have to accept.',
    },
    cmsldfebb00chy1vbj2a7u66m: {
      notes:
        '～がてら: Take the opportunity to do B while doing A.\n～かたわら: Engage in two activities in parallel over a sustained period.\n～かたがた: A formal way to combine purposes, often used for visits and greetings.',
    },
  };
  for (const [id, fields] of Object.entries(en)) {
    const index = translations.findIndex((r) => r.entityId === id),
      before = translations[index];
    const patch = sourcePatches.find(
      (p) => (p.after as { id: string }).id === id,
    );
    const original = patch
      ? patch.after
      : snapshot.GrammarRelationGroup.find((r) => r.id === id)!;
    const makeSource =
      before.entityType === 'GRAMMAR'
        ? grammarSource
        : before.entityType === 'EXAMPLE'
          ? exampleSource
          : relationSource;
    const updatedSource = makeSource(original as never);
    const after = {
      ...before,
      sourceHash: updatedSource.sourceHash,
      fields: { ...before.fields, ...fields },
      provenance: {
        provider: 'CODEX',
        model: 'coding-agent-editor',
        sourceHash: updatedSource.sourceHash,
        method: 'source-backed-editorial-correction-after-F-review',
        reviewedBy: 'C-source-reference-review; F-independent-recheck-pending',
        qualityVersion: 'static-en-v1' as const,
      },
      validatedAt: new Date().toISOString(),
    };
    translationEdits.push({
      issue: patch?.issue ?? 'F-advisory-gatera',
      before,
      after,
    });
    translations[index] = after;
  }
  const artifact = {
    version: 'source-correction-v1',
    batch: 'F-language-20260913',
    references: refs,
    sourcePatches,
    translationEdits,
    notes:
      'Source-backed coding-agent editorial correction. Independent F recheck remains pending. Previous source and English versions are preserved here and in the ImportBatch audit.',
  };
  await writeFile(path, text);
  await writeFile(
    'scripts/content-localization/corrections/F-language-20260913.json',
    JSON.stringify(artifact, null, 2) + '\n',
  );
  await writeFile(
    currentPath,
    translations.map((r) => JSON.stringify(r)).join('\n') + '\n',
  );
}
main().catch(() => {
  console.error('REMEDIATION_BUILD_FAILED');
  process.exitCode = 1;
});
