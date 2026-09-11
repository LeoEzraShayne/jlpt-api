import type { VocabularyEntry } from '@prisma/client';

// Chinese teaching glosses are separate from the original dictionary senses.
// A spelling alone is insufficient: both the reading and the source sense must match.
const entries = [
  ['報告', 'ほうこく', '报告；汇报', 'report'],
  ['挨拶', 'あいさつ', '问候；打招呼', 'greeting'],
  ['お礼', 'おれい', '感谢；谢意', 'thank|gratitude'],
  ['散歩', 'さんぽ', '散步', 'walk|stroll'],
  ['買い物', 'かいもの', '购物；买东西', 'shopping'],
  ['訪問', 'ほうもん', '拜访；访问', 'visit'],
  ['仕事', 'しごと', '工作', 'work|job'],
  ['勉強', 'べんきょう', '学习', 'study|studying'],
  ['計画', 'けいかく', '计划', 'plan'],
  ['安全', 'あんぜん', '安全', 'safe|safety'],
  ['重大', 'じゅうだい', '重大；严重', 'serious|important'],
  ['将来', 'しょうらい', '将来；未来', 'future'],
  ['判断', 'はんだん', '判断', 'judg'],
  ['解決', 'かいけつ', '解决', 'solution|resolution'],
  ['調査', 'ちょうさ', '调查', 'investigation|survey'],
  ['改善', 'かいぜん', '改善', 'improvement'],
  ['審査', 'しんさ', '审查；评审', 'judging|examination'],
  ['結果', 'けっか', '结果', '^result$|^outcome$'],
  ['感謝', 'かんしゃ', '感谢', 'gratitude|thanks'],
  ['手紙', 'てがみ', '信；书信', 'letter'],
  ['終了', 'しゅうりょう', '结束', 'end|termination'],
  ['サービス', 'サービス', '服务', '^service$'],
  ['参加', 'さんか', '参加', 'participation|joining'],
  ['活動', 'かつどう', '活动', 'activity|action'],
  ['公演', 'こうえん', '公开演出', 'public performance'],
  ['地域', 'ちいき', '地区；地域', 'region|area'],
  ['商品', 'しょうひん', '商品', 'goods|merchandise'],
  ['海外', 'かいがい', '海外；国外', 'abroad|overseas'],
  ['完成', 'かんせい', '完成', 'completion'],
  ['予定', 'よてい', '预定；计划', 'plan|schedule'],
  ['予算', 'よさん', '预算', 'budget'],
  ['費用', 'ひよう', '费用', 'cost|expense'],
  ['成長', 'せいちょう', '发展；增长', 'growth \\(of a company'],
  ['経済', 'けいざい', '经济', 'economy|economics'],
  ['時代', 'じだい', '时代', 'period|epoch|era'],
  ['変化', 'へんか', '变化', 'change|variation'],
  ['帰宅', 'きたく', '回家', 'returning home'],
  ['行動', 'こうどう', '行动；行为', 'action|conduct'],
  ['連絡', 'れんらく', '联系；联络', 'contacting|communication'],
  ['反応', 'はんのう', '反应', 'reaction|response'],
  ['単語', 'たんご', '单词；词汇', '^word$|vocabulary'],
  ['掃除', 'そうじ', '打扫；清扫', 'cleaning|sweeping'],
  ['部屋', 'へや', '房间', '^room$|chamber'],
  ['生活', 'せいかつ', '生活', 'living|life'],
  ['努力', 'どりょく', '努力', 'effort|endeavo'],
  ['目標', 'もくひょう', '目标', '^goal$|objective|target'],
  ['景色', 'けしき', '景色；风景', 'scenery|landscape'],
  ['経験', 'けいけん', '经验；经历', 'experience'],
  ['技術', 'ぎじゅつ', '技术', 'technology|technique'],
  ['場所', 'ばしょ', '地方；场所', 'place|location'],
  ['漢字', 'かんじ', '汉字', 'kanji|Chinese character'],
  ['時間', 'じかん', '时间', '^time$'],
  ['料理', 'りょうり', '料理；饭菜', 'cooking|cuisine'],
  ['接客', 'せっきゃく', '接待顾客', 'customer|guest'],
  ['能力', 'のうりょく', '能力', 'ability|capability'],
  ['成功', 'せいこう', '成功', 'success'],
  ['文化', 'ぶんか', '文化', '^culture$'],
  ['去年', 'きょねん', '去年', 'last year'],
  ['今年', 'ことし', '今年', 'this year'],
  ['運動', 'うんどう', '运动；锻炼', 'exercise|workout'],
  ['協力', 'きょうりょく', '协助；合作', 'cooperation|collaboration'],
  ['性格', 'せいかく', '性格', 'personality|character'],
  ['考え', 'かんがえ', '想法；看法', 'thinking|idea|thought'],
  ['責任', 'せきにん', '责任', 'responsibility'],
  ['規模', 'きぼ', '规模', '^scale$|scope'],
  ['専門家', 'せんもんか', '专家', 'specialist|expert'],
  ['失敗', 'しっぱい', '失败；失误', 'failure|mistake'],
  ['方針', 'ほうしん', '方针；方向', 'policy|plan'],
  ['理由', 'りゆう', '理由；原因', '^reason$|grounds'],
  ['規則', 'きそく', '规则；规定', 'rule|regulation'],
  ['条件', 'じょうけん', '条件', 'condition|requirement'],
  ['対応', 'たいおう', '应对；处理', 'dealing with|coping with'],
  ['契約', 'けいやく', '合同；契约', 'contract|agreement'],
  ['採用', 'さいよう', '录用；采用', 'employment|hiring|adoption'],
  ['反対', 'はんたい', '反对', 'opposition|objection'],
  ['困難', 'こんなん', '困难', 'difficulty|hardship'],
  ['心配', 'しんぱい', '担心；忧虑', 'worry|concern'],
  ['批判', 'ひはん', '批评', 'criticism'],
  ['態度', 'たいど', '态度', 'attitude'],
  ['電話', 'でんわ', '电话', 'telephone|phone'],
  ['相談', 'そうだん', '商量；咨询', 'consultation|discussion'],
  ['性能', 'せいのう', '性能', 'performance|efficiency'],
  ['製品', 'せいひん', '产品；制品', 'product|manufactured goods'],
] as const;
export const practiceVocabulary = entries.map(
  ([word, reading, chineseGloss, sense]) => ({
    word,
    reading,
    chineseGloss,
    sense: new RegExp(sense, 'i'),
  }),
);
export const PRACTICE_GLOSS_SOURCE = 'grammar-practice-gloss-zh-v1';
export function practiceMeaning(
  entry: Pick<VocabularyEntry, 'word' | 'reading' | 'glosses'>,
) {
  const meaning = practiceVocabulary.find(
    (candidate) =>
      candidate.word === entry.word && candidate.reading === entry.reading,
  );
  if (!meaning || !Array.isArray(entry.glosses)) return null;
  return entry.glosses.some(
    (gloss) =>
      gloss &&
      typeof gloss === 'object' &&
      'text' in gloss &&
      typeof gloss.text === 'string' &&
      meaning.sense.test(gloss.text),
  )
    ? meaning
    : null;
}
