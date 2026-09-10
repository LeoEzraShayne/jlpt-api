import { createHash } from 'node:crypto';
import type { CandidateRowDto } from './content.dto';

export const normalizeContent = (value: string) =>
  value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
export function fingerprint(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function candidateFingerprint(row: CandidateRowDto) {
  // Document format, source filename and asserted JLPT level aren't identity.
  // Keep reading AND meaning: homophones and polysemy must remain distinct.
  return fingerprint([
    row.kind,
    normalizeContent(row.word),
    normalizeContent(row.reading),
    normalizeContent(row.gloss),
    normalizeContent(row.senseKey ?? ''),
  ]);
}
export function candidateProblems(row: CandidateRowDto) {
  const problems: string[] = [];
  if (
    /�|\\u[0-9a-f]{4}|EQ \\|HYPERLINK/iu.test(
      `${row.word} ${row.reading} ${row.gloss}`,
    )
  )
    problems.push('内容包含乱码或未解析的文档标记');
  if (!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(row.word))
    problems.push('缺少可识别的日语词形或表达');
  if (row.kind === 'VOCABULARY' && !row.reading.trim())
    problems.push('缺少读音');
  if (
    row.reading &&
    !/^[\p{Script=Hiragana}\p{Script=Katakana}ー\s]+$/u.test(row.reading)
  )
    problems.push('读音包含非假名字符或多个未拆分的读音');
  if (row.level && !row.levelSource?.trim()) problems.push('分级缺少来源');
  if (!row.gloss.trim()) problems.push('缺少释义');
  return problems;
}
