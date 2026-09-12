import { z } from 'zod';
/** Feedback comes only from a fixed allowlist of schema paths, never model text,
 * error payloads, user commands, or arbitrary error messages. */
export function validationFeedback(error: unknown) {
  if (!(error instanceof z.ZodError)) return undefined;
  const fields = new Set(
    error.issues.map((issue) => String(issue.path[0] ?? '')),
  );
  const notes: string[] = [];
  if ([...fields].some((f) => f.endsWith('_score')))
    notes.push(
      'Re-evaluate the ORIGINAL sentence. All five component scores must respect their stated integer maxima. Compute total_score as their EXACT sum; apply the missing/incorrect target caps through consistent component scores. Never replace original evidence with your correction.',
    );
  if ([...fields].some((f) => /furigana/i.test(f)))
    notes.push(
      'Furigana must reproduce the exact same sentence characters: no changed kanji, no changed conjugation, no spaces added. Annotate every kanji group with hiragana but never annotate kana-only words.',
    );
  if (fields.has('chunks'))
    notes.push(
      'Ordered phrase chunks must reconstruct exactly the reference sentence apart from punctuation and whitespace.',
    );
  if (
    [...fields].some((f) =>
      /^(?:promptZh|meaningHintZh|referenceSentence|grammarId)$/.test(f),
    )
  )
    notes.push(
      'The Japanese reference must naturally use the supplied target in its specified sense; use only allowed grammar IDs or null. Scenario and first hint must conceal the Japanese word/reading and must require an answer in JAPANESE, regardless of explanation language.',
    );
  if (
    [...fields].some((f) =>
      /^(?:usedTarget|targetCorrect|meaningCorrect|readingCorrect)$/.test(f),
    )
  )
    notes.push(
      'Judge only original vocabulary evidence: absent target => usedTarget=false, targetCorrect=null, meaningCorrect=null. Correct current-sense target requires both correctness flags true. readingCorrect is always null in sentence production.',
    );
  if (
    [...fields].some((f) =>
      /^(?:explanationZh|correctedTranslationZh|corrections)$/.test(f),
    )
  )
    notes.push(
      'Use natural learner-facing explanations in the requested language. Do not expose API fields, boolean values, or memory/scoring internals. Every correction must identify an actual changed span of the original answer.',
    );
  return notes.length ? notes.join(' ') : undefined;
}
