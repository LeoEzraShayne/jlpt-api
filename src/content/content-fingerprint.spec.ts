import { candidateFingerprint, candidateProblems } from './content-fingerprint';
const sample = { kind: 'VOCABULARY', word: '橋', reading: 'はし', gloss: '桥' };
describe('content identity and quality gates', () => {
  it('deduplicates differently formatted documents without treating source as identity', () => {
    expect(candidateFingerprint(sample)).toBe(
      candidateFingerprint({
        ...sample,
        word: ' 橋 ',
        location: 'other.pdf:p3',
      }),
    );
  });
  it('keeps homophones, alternative readings and senses distinct', () => {
    for (const variant of [
      { word: '箸' },
      { reading: 'きょう' },
      { gloss: '桥梁（比喻）' },
    ])
      expect(candidateFingerprint({ ...sample, ...variant })).not.toBe(
        candidateFingerprint(sample),
      );
  });
  it('blocks missing reading, corrupted text and untraceable classification', () => {
    expect(
      candidateProblems({ ...sample, reading: '', level: 'N1' }),
    ).toHaveLength(2);
    expect(candidateProblems({ ...sample, gloss: '�' })).toHaveLength(1);
    expect(
      candidateProblems({ ...sample, kind: 'PHRASE', reading: '' }),
    ).toHaveLength(0);
  });
});
