import { createHash } from 'node:crypto';
import { JlptLevel } from '@prisma/client';

export interface ParsedGrammar {
  level: JlptLevel;
  ordinal: number;
  title: string;
  explanation: string;
  connectionRule?: string;
  example: string;
  translation: string;
  sourceLine: number;
  sourceHash: string;
}
export interface ParsedRelation {
  level: JlptLevel;
  ordinal: number;
  title: string;
  notes: string;
  memberHints: string[];
  sourceLine: number;
}
export interface ParseIssue {
  line?: number;
  code: string;
  message: string;
}
export interface ParseResult {
  grammars: ParsedGrammar[];
  relations: ParsedRelation[];
  issues: ParseIssue[];
  counts: Record<JlptLevel, number>;
  fileHash: string;
}

const expected: Record<JlptLevel, number> = {
  N1: 40,
  N2: 40,
  N3: 100,
  N4: 43,
};

export function parseGrammarText(content: string): ParseResult {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const grammars: ParsedGrammar[] = [];
  const relations: ParsedRelation[] = [];
  const issues: ParseIssue[] = [];
  let level: JlptLevel | undefined;
  let current:
    | {
        ordinal: number;
        title: string;
        line: number;
        fields: Record<string, string>;
      }
    | undefined;
  let relation:
    | { ordinal: number; title: string; line: number; notes: string[] }
    | undefined;
  let inRelations = false;

  const flushGrammar = () => {
    if (!current || !level) return;
    const missing = ['中文解释', '例句', '译文'].filter(
      (key) => !current!.fields[key],
    );
    if (missing.length)
      issues.push({
        line: current.line,
        code: 'MISSING_FIELD',
        message: `${level}-${current.ordinal} missing ${missing.join(', ')}`,
      });
    const raw = `${level}|${current.ordinal}|${current.title}|${JSON.stringify(current.fields)}`;
    grammars.push({
      level,
      ordinal: current.ordinal,
      title: current.title,
      explanation: current.fields['中文解释'] ?? '',
      connectionRule: current.fields['接续'],
      example: current.fields['例句'] ?? '',
      translation: current.fields['译文'] ?? '',
      sourceLine: current.line,
      sourceHash: createHash('sha256').update(raw).digest('hex'),
    });
    current = undefined;
  };
  const flushRelation = () => {
    if (!relation) return;
    const noteText = relation.notes.join('\n');
    const hints = [
      ...relation.title.split('／'),
      ...relation.notes.map((note) => note.split(/[：:]/)[0]),
    ]
      .map((value) => value.trim())
      .filter((value) => value.startsWith('～'));
    relations.push({
      level: JlptLevel.N1,
      ordinal: relation.ordinal,
      title: relation.title,
      notes: noteText,
      memberHints: [...new Set(hints)],
      sourceLine: relation.line,
    });
    relation = undefined;
  };

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    const lineNo = index + 1;
    if (/^【N1容易混淆的语法】$/.test(line)) {
      flushGrammar();
      inRelations = true;
      return;
    }
    if (/^N[1-3]$/.test(line) || line === 'N4,5') {
      flushGrammar();
      flushRelation();
      inRelations = false;
      level = line === 'N4,5' ? JlptLevel.N4 : (line as JlptLevel);
      return;
    }
    if (/^-{5,}$/.test(line) || !line) return;
    const numbered = line.match(/^(\d+)\.\s*(.+)$/);
    if (numbered) {
      if (inRelations) {
        flushRelation();
        relation = {
          ordinal: Number(numbered[1]),
          title: numbered[2],
          line: lineNo,
          notes: [],
        };
      } else {
        flushGrammar();
        current = {
          ordinal: Number(numbered[1]),
          title: numbered[2],
          line: lineNo,
          fields: {},
        };
      }
      return;
    }
    if (inRelations && relation) {
      relation.notes.push(line);
      return;
    }
    const field = line.match(/^(中文解释|接续|例句|译文)：(.*)$/);
    if (field && current) current.fields[field[1]] = field[2].trim();
  });
  flushGrammar();
  flushRelation();

  const counts = Object.fromEntries(
    Object.values(JlptLevel).map((item) => [
      item,
      grammars.filter((grammar) => grammar.level === item).length,
    ]),
  ) as Record<JlptLevel, number>;
  for (const item of Object.values(JlptLevel))
    if (counts[item] !== expected[item])
      issues.push({
        code: 'COUNT_MISMATCH',
        message: `${item}: expected ${expected[item]}, got ${counts[item]}`,
      });
  const keys = new Set<string>();
  for (const grammar of grammars) {
    const key = `${grammar.level}:${grammar.ordinal}`;
    if (keys.has(key))
      issues.push({
        line: grammar.sourceLine,
        code: 'DUPLICATE_SOURCE_KEY',
        message: key,
      });
    keys.add(key);
  }
  return {
    grammars,
    relations,
    issues,
    counts,
    fileHash: createHash('sha256').update(content).digest('hex'),
  };
}
