const alternativeSeparator = /[・／/]/;
const placeholderPattern = /[A-Za-zＡ-Ｚａ-ｚ]/;
const kanaPattern = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;

export function suggestionUsesTargetGrammar(title: string, sentence: string) {
  const candidates = title
    .normalize('NFKC')
    .split(alternativeSeparator)
    .map((part) => part.replace(/[（(][^）)]*[）)]/g, ''))
    .filter((part) => !placeholderPattern.test(part))
    .map((part) =>
      part
        .split(/[～〜~]/)
        .map((fragment) => fragment.replace(/[\s「」『』【】]/g, ''))
        .filter(
          (fragment) => fragment.length >= 2 && kanaPattern.test(fragment),
        ),
    )
    .filter((fragments) => fragments.length > 0);
  if (candidates.length === 0) return true;
  return candidates.some((fragments) =>
    fragments.every((fragment) => sentence.includes(fragment)),
  );
}
