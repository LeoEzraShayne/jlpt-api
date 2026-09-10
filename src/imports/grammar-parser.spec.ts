import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseGrammarText } from './grammar-parser';

describe('parseGrammarText', () => {
  const content = readFileSync(
    resolve(process.cwd(), 'data/N1-N5语法总结-有解释例句.txt'),
    'utf8',
  );
  const result = parseGrammarText(content);

  it('parses the approved level baseline', () => {
    expect(result.counts).toEqual({ N1: 40, N2: 40, N3: 100, N4: 43 });
    expect(result.grammars).toHaveLength(223);
    expect(result.issues).toEqual([]);
  });

  it('maps the combined beginner section to N4', () => {
    expect(result.grammars.filter((item) => item.level === 'N4')).toHaveLength(
      43,
    );
  });

  it('parses N1 confusion notes as relations rather than grammar points', () => {
    expect(result.relations).toHaveLength(6);
    expect(result.relations[0].memberHints).toEqual(
      expect.arrayContaining(['～が早いか', '～や否や', '～なり']),
    );
  });
});
