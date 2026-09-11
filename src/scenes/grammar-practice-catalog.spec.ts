import { readFileSync } from 'node:fs';
import { parseGrammarText } from '../imports/grammar-parser';
import {
  practiceProfile,
  practiceProfiles,
  PRACTICE_SELECTION_VERSION,
} from './grammar-practice-catalog';
import { validateScenarioEvidence } from '../study-sessions/review-evidence';
import { practiceMeaning } from '../content/practice-vocabulary';

test('all imported N1 titles have exactly one use-specific profile, including different なり and いかん uses', () => {
  const source = readFileSync('data/N1-N5语法总结-有解释例句.txt', 'utf8');
  const titles = parseGrammarText(source)
    .grammars.filter((g) => g.level === 'N1')
    .map((g) => g.title);
  expect(titles).toHaveLength(40);
  for (const title of titles) {
    expect(practiceProfiles.filter((p) => p.match.test(title))).toHaveLength(1);
  }
  expect(practiceProfile('～なり～なり')!.tasks[0].objective).toBe(
    'OFFER_CONTACT_OPTIONS',
  );
  expect(practiceProfile('未登録の文法')).toBeUndefined();
});
test('かたがた tasks are polite visits with suitable vocabulary and genuinely different objectives', () => {
  const profile = practiceProfile('～かたがた')!;
  expect(profile.register).toBe('POLITE');
  expect(profile.tasks[0].words).toEqual(['報告', '挨拶']);
  expect(profile.tasks[1].words).toEqual(['お礼', '挨拶']);
  expect(profile.tasks[0].objective).not.toBe(profile.tasks[1].objective);
  expect(profile.tasks.every((t) => !t.promptZh.includes('反对意见'))).toBe(
    true,
  );
});
test('Chinese gloss is tied to the greeting sense, not reply/speech or a different reading', () => {
  const word = {
    word: '挨拶',
    reading: 'あいさつ',
    glosses: [{ text: 'greeting' }],
  };
  expect(practiceMeaning(word)?.chineseGloss).toBe('问候；打招呼');
  expect(practiceMeaning({ ...word, glosses: [{ text: 'reply' }] })).toBeNull();
  expect(practiceMeaning({ ...word, reading: 'other' })).toBeNull();
});
test('legacy arbitrary scenarios cannot substantiate new cross-scene evidence', () => {
  const context = (id: string, objective: string, version?: string) => ({
    selectionVersion: version,
    scenario: {
      version: 'scenario-v1',
      scenarioId: id,
      taskId: id,
      objectiveId: objective,
      register: 'POLITE',
    },
  });
  const base = {
    scenarioId: 'new',
    trainingMode: 'TRANSFER',
    taskCompleted: true,
    trainingContext: context('new', 'THANKS', PRACTICE_SELECTION_VERSION),
  };
  expect(
    validateScenarioEvidence({
      ...base,
      previous: [
        { scenarioId: 'old', trainingContext: context('old', 'REPORT') },
      ],
    }).crossScenarioValid,
  ).toBe(false);
  expect(
    validateScenarioEvidence({
      ...base,
      previous: [
        {
          scenarioId: 'old',
          trainingContext: context('old', 'REPORT', PRACTICE_SELECTION_VERSION),
        },
      ],
    }).crossScenarioValid,
  ).toBe(true);
});
