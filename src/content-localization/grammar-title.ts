/** Source titles contain Japanese forms with Chinese sense disambiguators. */
const senseLabels: Record<string, string> = {
  手段: 'means',
  '期限、结束': 'deadline / ending',
  目的: 'purpose',
  先后: 'sequence',
  对象: 'target',
  媒介: 'medium',
  整个期间: 'throughout a period',
  趁着: 'while the opportunity lasts',
  变化: 'change',
  对比: 'contrast',
  比喻: 'comparison',
  被动动作主体: 'agent in a passive sentence',
  最低程度: 'minimum degree',
  原因: 'cause',
};
export function grammarDisplayTitle(title: string, locale: 'zh' | 'en') {
  return locale === 'zh'
    ? title
    : title.replace(/（([^）]+)）/g, (original: string, label: string) =>
        senseLabels[label] ? ` (${senseLabels[label]})` : original,
      );
}
