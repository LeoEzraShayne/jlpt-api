import { providerReviewSchema, validFurigana } from './review-schema';
import { assertResponse, parseReviewJson } from './provider-utils';
import { ProviderError } from './ai-provider';

const validReview = {
  total_score: 80,
  grammar_score: 25,
  connection_score: 18,
  completeness_score: 15,
  naturalness_score: 14,
  vocabulary_score: 8,
  is_correct: true,
  used_target_grammar: true,
  target_grammar_correct: true,
  result_level: 'MOSTLY_CORRECT',
  error_spans: [],
  corrected_sentence: '少子化は国家の存続にかかわる重要な問題です。',
  corrected_sentence_furigana:
    '少子化[しょうしか]は国家[こっか]の存続[そんぞく]にかかわる重要[じゅうよう]な問題[もんだい]です。',
  corrected_sentence_translation_zh: '少子化是关系到国家存续的重要问题。',
  corrected_sentence_uses_target_grammar: true,
  alternative_sentence: 'この問題は国の将来にかかわります。',
  alternative_sentence_uses_target_grammar: true,
  alternative_sentence_furigana:
    'この問題[もんだい]は国[くに]の将来[しょうらい]にかかわります。',
  alternative_sentence_translation_zh: '这个问题关系到国家的未来。',
  explanation_zh: '表达正确。',
  encouragement: '继续加油。',
} as const;

describe('AI review schema', () => {
  it('accepts complete hiragana annotations', () => {
    expect(providerReviewSchema.safeParse(validReview).success).toBe(true);
    expect(
      validFurigana(
        validReview.alternative_sentence,
        validReview.alternative_sentence_furigana,
      ),
    ).toBe(true);
  });

  it('rejects incomplete or changed correction annotations', () => {
    for (const annotated of [
      validReview.corrected_sentence,
      '別[べつ]の文[ぶん]。',
    ]) {
      expect(
        providerReviewSchema.safeParse({
          ...validReview,
          corrected_sentence_furigana: annotated,
        }).success,
      ).toBe(false);
    }
  });

  it('accepts a reading attached after okurigana', () => {
    expect(validFurigana('皮切りにする。', '皮切り[かわきり]にする。')).toBe(
      true,
    );
  });

  it('rejects an unannotated kanji group', () => {
    expect(
      providerReviewSchema.safeParse({
        ...validReview,
        alternative_sentence_furigana:
          'この問題は国[くに]の将来[しょうらい]にかかわります。',
      }).success,
    ).toBe(false);
  });

  it('rejects suggestions that admit dropping the target grammar', () => {
    expect(
      providerReviewSchema.safeParse({
        ...validReview,
        corrected_sentence_uses_target_grammar: false,
      }).success,
    ).toBe(false);
  });

  it('normalizes providers that repeat readings in the plain sentence', () => {
    const parsed = parseReviewJson(
      JSON.stringify({
        ...validReview,
        alternative_sentence:
          'この問題[もんだい]は国[くに]の将来[しょうらい]にかかわります。',
      }),
    );
    expect(parsed.alternative_sentence).toBe(
      'この問題は国の将来にかかわります。',
    );
  });

  it('allows fallback when a provider rejects the server location', () => {
    const body = JSON.stringify({
      error: {
        code: 400,
        message: 'User location is not supported for the API use.',
        status: 'FAILED_PRECONDITION',
      },
    });
    try {
      assertResponse(new Response(body, { status: 400 }), body);
      throw new Error('Expected a provider error');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      expect(error).toMatchObject({ code: 'AI_HTTP_400', retryable: true });
    }
  });

  it('does not retry unrelated bad requests', () => {
    const body = JSON.stringify({ error: { message: 'Invalid request' } });
    try {
      assertResponse(new Response(body, { status: 400 }), body);
      throw new Error('Expected a provider error');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      expect(error).toMatchObject({ code: 'AI_HTTP_400', retryable: false });
    }
  });
});
