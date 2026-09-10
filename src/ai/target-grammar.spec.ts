import { suggestionUsesTargetGrammar } from './target-grammar';

describe('target grammar suggestion guard', () => {
  it('rejects replacing the learning target with a different grammar', () => {
    expect(
      suggestionUsesTargetGrammar(
        '～にかかわる',
        '少子化は国家にとって重要な問題です。',
      ),
    ).toBe(false);
  });

  it('accepts a corrected sentence that retains the target grammar', () => {
    expect(
      suggestionUsesTargetGrammar(
        '～にかかわる',
        '少子化は国家の存続にかかわる重要な問題です。',
      ),
    ).toBe(true);
  });

  it('supports alternative titles and split grammar patterns', () => {
    expect(
      suggestionUsesTargetGrammar(
        '～に関して・～に関する',
        '環境に関する本です。',
      ),
    ).toBe(true);
    expect(
      suggestionUsesTargetGrammar('ただ～のみ', '今はただ待つのみです。'),
    ).toBe(true);
  });
});
