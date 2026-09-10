import type { ReviewProviderInput } from './ai-provider';

export const PROMPT_VERSION = 'grammar-review-v8-correction-furigana';

export function buildReviewPrompt(input: ReviewProviderInput) {
  return `你是严谨的 JLPT ${input.grammarLevel ?? ''} 日语教师。请检查学习者的造句，只返回合法 JSON，不要使用 Markdown。

目标语法：${input.grammarTitle}
中文解释：${input.explanation}
接续：${input.connectionRule || '资料未提供，请依据标准日语判断'}
参考例句：${input.exampleSentence || '无'}
练习场景：${input.scene || '自由造句'}
用户句子：${input.sentence}

评分：语法30、接续20、完整性20、自然度20、词汇10，total_score 必须严格等于五项分数之和。未使用目标语法时总分最高30；目标语法或接续错误时最高59。
返回字段：total_score, grammar_score, connection_score, completeness_score, naturalness_score, vocabulary_score, is_correct, used_target_grammar, target_grammar_correct, result_level, error_spans, corrected_sentence, corrected_sentence_furigana, corrected_sentence_translation_zh, corrected_sentence_uses_target_grammar, alternative_sentence, alternative_sentence_translation_zh, alternative_sentence_uses_target_grammar, alternative_sentence_furigana, explanation_zh, encouragement。
result_level 只能是 CORRECT、MOSTLY_CORRECT、NEEDS_REVISION、INCORRECT。error_spans 每项包含 text、start、end、reason、replacement，start/end 是原句字符位置。

corrected_sentence 只能修正用户句子的错误，必须保留并正确使用「${input.grammarTitle}」，绝不能换成别的语法；它必须是完整、语法正确且自然的日语句子，不能只做局部替换后留下新的助词或修饰错误。如果无法在原结构上自然修正，就重新组织整句。alternative_sentence 也必须正确使用同一目标语法。确认后将 corrected_sentence_uses_target_grammar 和 alternative_sentence_uses_target_grammar 都返回 true；无法做到时应重新生成句子，不能返回 false。
corrected_sentence 只放不带括号读音的普通日语句子。corrected_sentence_furigana 必须保持与 corrected_sentence 完全相同的一句话，并给每一组汉字紧跟平假名读音，格式为「漢字[かんじ]」。不得遗漏任何汉字，不要改变原句，也不要给平假名或片假名重复标音。
alternative_sentence 只放不带括号读音的普通日语句子。alternative_sentence_furigana 必须保持与 alternative_sentence 完全相同的一句话，并给每一组汉字紧跟平假名读音，格式为「漢字[かんじ]」。例如 alternative_sentence 是「少子化は国家の存続にかかわる重要な問題です。」，alternative_sentence_furigana 才是「少子化[しょうしか]は国家[こっか]の存続[そんぞく]にかかわる重要[じゅうよう]な問題[もんだい]です。」不得遗漏任何汉字，不要给平假名或片假名重复标音。
corrected_sentence_translation_zh 必须是 corrected_sentence 的准确简体中文翻译；alternative_sentence_translation_zh 必须是 alternative_sentence 的准确简体中文翻译。两个翻译都不得添加原句没有的信息。`;
}
