import type { TrainingScenario } from '@prisma/client';
import { chooseScenario, chooseTrainingMode } from './scenario-selection';
import { presentSession, type TrainingContext } from './training-context';
import { SceneService } from './scenes.service';
import { validateScenarioEvidence } from '../study-sessions/review-evidence';

const scenario = (
  id: string,
  objective: string,
  register = 'POLITE',
): TrainingScenario => ({
  id,
  objective,
  register,
  domain: 'LIFE',
  promptZh: '完成一个有目的的表达',
  levels: ['N1'],
  active: true,
  version: 'scenario-v1',
});
const context = (
  id = 'life-propose-plan',
  objective = 'PROPOSE_PLAN',
): TrainingContext => ({
  version: 'training-v1',
  instructionZh: '独立完成任务',
  scenario: {
    version: 'scenario-v1',
    id,
    scenarioId: id,
    taskId: `scenario-v1:${id}:${objective}`,
    objectiveId: objective,
    objective,
    domain: 'LIFE',
    register: 'POLITE',
    promptZh: '提出一个有理由的计划',
  },
  words: [
    {
      id: 'w1',
      word: '予定',
      reading: 'よてい',
      chineseGloss: '计划',
      glosses: [],
      sourceName: 'test',
      sourceVersion: 'v1',
    },
  ],
  supportingGrammar: { id: 'g2', title: '〜ことにする', level: 'N3' },
  expressions: [
    {
      id: 'e1',
      sentence: '秘密の参考表現',
      furigana: '秘密[ひみつ]の参考[さんこう]表現[ひょうげん]',
      translationZh: '不可泄露译文',
      provenance: { quote: '不泄露来源文字' },
    },
  ],
  phrases: [
    {
      id: 'p1',
      word: '不泄露短语',
      reading: 'ない',
      payload: { meaning: '不泄露义项' },
    },
  ],
});

describe('server scene training', () => {
  it('allows early substitution and gradually introduces combination and transfer', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(chooseTrainingMode)).toEqual([
      'UNDERSTAND',
      'SUBSTITUTE',
      'SUBSTITUTE',
      'COMBINE',
      'TRANSFER',
      'TRANSFER',
      'COMBINE',
    ]);
  });
  it('preserves an early familiar scene but requires a different objective for transfer', () => {
    const scenes = [
      scenario('a', 'PLAN'),
      scenario('noun-only', 'PLAN'),
      scenario('b', 'REQUEST_HELP'),
    ];
    const history = [{ trainingContext: context('a', 'PLAN') }];
    const grammar = { level: 'N1', chineseExplanation: '一个表达' };
    expect(chooseScenario(scenes, history, 'SUBSTITUTE', grammar)?.id).toBe(
      'a',
    );
    expect(chooseScenario(scenes, history, 'TRANSFER', grammar)?.id).toBe('b');
    expect(
      chooseScenario(scenes.slice(0, 2), history, 'TRANSFER', grammar),
    ).toBeNull();
  });
  it('respects formal/casual register cues and never invents a compatible scene', () => {
    const scenes = [
      scenario('casual', 'PLAN', 'CASUAL'),
      scenario('formal', 'IMPACT', 'FORMAL_WRITTEN'),
    ];
    expect(
      chooseScenario(scenes, [], 'UNDERSTAND', {
        level: 'N1',
        chineseExplanation: '正式书面表达',
      })?.id,
    ).toBe('formal');
    expect(
      chooseScenario(scenes, [], 'UNDERSTAND', {
        level: 'N1',
        chineseExplanation: '日常口语',
      })?.id,
    ).toBe('casual');
  });
  it('requires completed server objective and different scenario for evidence', () => {
    const current = context('b', 'REQUEST_HELP');
    const base = {
      scenarioId: 'b',
      trainingMode: 'TRANSFER',
      trainingContext: current,
      taskCompleted: true,
      previous: [{ scenarioId: 'a', trainingContext: context('a', 'PLAN') }],
    };
    expect(validateScenarioEvidence(base).crossScenarioValid).toBe(true);
    expect(
      validateScenarioEvidence({ ...base, taskCompleted: false })
        .crossScenarioValid,
    ).toBe(false);
    expect(
      validateScenarioEvidence({
        ...base,
        previous: [
          { scenarioId: 'a', trainingContext: context('a', 'REQUEST_HELP') },
        ],
      }).crossScenarioValid,
    ).toBe(false);
    expect(
      validateScenarioEvidence({
        ...base,
        trainingContext: { scene: '用户说已完成' },
      }).crossScenarioValid,
    ).toBe(false);
  });
  it.each(['ACTIVE', 'COMPLETED'])(
    'redacts reference text on generic response regardless of status/revealedAt: %s',
    (status) => {
      const session = {
        mode: 'REVIEW',
        status,
        revealedAt: new Date(),
        trainingContext: context(),
        grammar: {
          title: '目标',
          examples: [{ sentence: '不泄露例句' }],
          chineseExplanation: '不泄露解释',
          connectionRule: '不泄露接续',
        },
      };
      const serialized = JSON.stringify(presentSession(session));
      for (const secret of ['秘密', '不可泄露', '不泄露'])
        expect(serialized).not.toContain(secret);
      expect(serialized).toContain('PROPOSE_PLAN');
      expect(presentSession(session).trainingContext?.referenceHidden).toBe(
        true,
      );
      expect(JSON.stringify(presentSession(session, true))).toContain('秘密');
    },
  );
  it('fails closed for unknown reference payload shapes', () => {
    expect(
      presentSession({
        mode: 'REVIEW',
        trainingContext: { malicious: 'secret' },
      }).trainingContext,
    ).toBeNull();
  });
  it('tracks only actually selected observed auxiliary words/grammar, without score writes', async () => {
    const recordExposure = jest.fn().mockResolvedValue({});
    const service = new SceneService({ recordExposure } as never);
    await service.recordUsed(
      'u1',
      's1',
      context(),
      '予定をあしたにすることにする。',
      'いいことにする。',
    );
    expect(recordExposure).toHaveBeenCalledWith(
      'u1',
      's1',
      'VOCABULARY',
      'w1',
      'USED',
    );
    expect(recordExposure).toHaveBeenCalledWith(
      'u1',
      's1',
      'GRAMMAR',
      'g2',
      'USED',
    );
    expect(recordExposure).toHaveBeenCalledWith(
      'u1',
      's1',
      'GRAMMAR',
      'g2',
      'EXPOSED',
    );
    expect(recordExposure).toHaveBeenCalledTimes(3);
    recordExposure.mockClear();
    await service.recordUsed('u1', 's1', context(), 'いいね。', 'いいね。');
    expect(recordExposure).not.toHaveBeenCalled();
  });
  it('never counts hidden reference text as exposure until explicitly revealed', async () => {
    const recordExposure = jest.fn().mockResolvedValue({});
    const service = new SceneService({ recordExposure } as never);
    await service.recordShown('u1', 's1', context(), false);
    expect(recordExposure).not.toHaveBeenCalledWith(
      'u1',
      's1',
      'EXPRESSION',
      'e1',
      'EXPOSED',
    );
    await service.recordShown('u1', 's1', context(), true);
    expect(recordExposure).toHaveBeenCalledWith(
      'u1',
      's1',
      'EXPRESSION',
      'e1',
      'EXPOSED',
    );
  });
  it('keeps the task when supplementary selection fails', async () => {
    const service = new SceneService({
      selectForPractice: jest.fn().mockRejectedValue(new Error('offline')),
    } as never);
    const tx = {
      studySession: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      trainingScenario: {
        findMany: jest.fn().mockResolvedValue([scenario('life', 'PLAN')]),
      },
    };
    const assigned = await service.assign(tx as never, 'u1', 's1', {
      id: 'g1',
      level: 'N1',
      chineseExplanation: '目标',
    });
    expect(assigned).toMatchObject({
      scenarioId: 'life',
      trainingMode: 'UNDERSTAND',
      trainingContext: { words: [], expressions: [] },
    });
  });
});
