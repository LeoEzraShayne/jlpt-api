import { coreReviewSchema } from './review-schema';
import { parseReviewJson, fetchWithTimeout } from './provider-utils';
import { geminiJsonSchema } from './gemini-json-schema';
import { buildReviewPrompt } from './prompt';

const core = {
  total_score: 100,
  grammar_score: 30,
  connection_score: 20,
  completeness_score: 20,
  naturalness_score: 20,
  vocabulary_score: 10,
  is_correct: true,
  used_target_grammar: true,
  target_grammar_correct: true,
  result_level: 'CORRECT',
  error_spans: [],
  corrected_sentence: '歩きながら話します。',
  corrected_sentence_furigana: '歩[ある]きながら話[はな]します。',
  corrected_sentence_translation_zh: '边走边说。',
  corrected_sentence_uses_target_grammar: true,
  explanation_zh: '表达正确。',
  encouragement: '继续练习。',
  scenario_task_completed: false,
};
const extra = {
  alternative_sentence: '食べながら話します。',
  alternative_sentence_furigana: '食[た]べながら話[はな]します。',
  alternative_sentence_translation_zh: '边吃边说。',
  alternative_sentence_uses_target_grammar: true,
  next_practice: '描述别的动作。',
};

describe('progressive review boundary', () => {
  it('accepts core without an extension but never relaxes score, target or reading validation', () => {
    expect(parseReviewJson(JSON.stringify(core), true).total_score).toBe(100);
    for (const changed of [
      { total_score: 80 },
      { corrected_sentence_furigana: core.corrected_sentence },
      { corrected_sentence_uses_target_grammar: false },
      { target_grammar_correct: true, used_target_grammar: false },
    ]) {
      expect(coreReviewSchema.safeParse({ ...core, ...changed }).success).toBe(
        false,
      );
    }
  });
  it('does not accept unsolicited auxiliary content as core review data', () => {
    const result = parseReviewJson(JSON.stringify({ ...core, ...extra }), true);
    expect(result.alternative_sentence).toBeUndefined();
    expect(result.next_practice).toBeUndefined();
  });
  it('keeps real corrections but removes unchanged fragments incorrectly labelled as errors', () => {
    const changed = {
      text: '彼は',
      replacement: '私は',
      start: 0,
      end: 2,
      reason: '前后两个动作需要同一主体。',
    };
    const result = parseReviewJson(
      JSON.stringify({
        ...core,
        error_spans: [
          changed,
          {
            text: '勉強します',
            replacement: '勉強します',
            start: 3,
            end: 8,
            reason: '这部分可以保留。',
          },
        ],
      }),
      true,
    );
    expect(result.error_spans).toEqual([changed]);
  });
  it('requests grading, detailed corrections and scene evidence without extras', () => {
    const coreKeys = Object.keys(geminiJsonSchema('CORE').properties);
    const extensionKeys = Object.keys(extra);
    expect(coreKeys).toContain('scenario_task_completed');
    expect(coreKeys.filter((key) => extensionKeys.includes(key))).toEqual([]);
    expect(
      buildReviewPrompt({
        stage: 'CORE',
        grammarTitle: 'ながら',
        explanation: '一边',
        sentence: core.corrected_sentence,
      }),
    ).toContain('不生成拓展示例');
  });
  it('times out while reading a response body, even after headers arrived', async () => {
    const original = global.fetch;
    jest.useFakeTimers();
    global.fetch = jest.fn((_url, init) =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      }),
    ) as typeof fetch;
    try {
      const pending = expect(
        fetchWithTimeout('https://example.test', {}, 100),
      ).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
      await jest.advanceTimersByTimeAsync(100);
      await pending;
    } finally {
      global.fetch = original;
      jest.useRealTimers();
    }
  });
});
