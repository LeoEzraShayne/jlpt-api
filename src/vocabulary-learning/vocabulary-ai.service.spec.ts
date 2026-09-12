import type { PrismaService } from '../database/prisma.service';
import { ConfigService } from '@nestjs/config';
import { ProviderError } from '../ai/ai-provider';
import { fetchWithTimeout } from '../ai/provider-utils';
import { VocabularyAiService } from './vocabulary-ai.service';
import type {
  AiVocabularyInput,
  Challenge,
  WordAssessment,
} from './vocabulary-ai.schema';

jest.mock('../ai/provider-utils', () => ({
  ...jest.requireActual<typeof import('../ai/provider-utils')>(
    '../ai/provider-utils',
  ),
  fetchWithTimeout: jest.fn(),
}));
const request = jest.mocked(fetchWithTimeout);
const input: AiVocabularyInput = {
  word: '断る',
  reading: 'ことわる',
  chineseGloss: '拒绝请求',
  senseKey: 'refuse',
  glosses: [{ language: 'eng', text: 'refuse a request' }],
  grammars: [
    {
      id: 'g1',
      title: '〜ても',
      chineseExplanation: '即使',
      connectionRule: 'て形＋も',
    },
  ],
  previousPrompts: ['同事请你替班，但你已有安排。'],
};
const challenge: Challenge = {
  promptZh: '你已有安排，朋友却邀请你周末帮忙搬家。请礼貌地表示无法接受。',
  meaningHintZh: '表达不接受他人的请求或邀请。',
  grammarId: null,
  referenceSentence: '友達の誘いを断った。',
  referenceFurigana: '友達[ともだち]の誘[さそ]いを断[ことわ]った。',
  referenceTranslationZh: '拒绝了朋友的邀请。',
  chunks: ['友達の', '誘いを', '断った。'],
};
const assessment: WordAssessment = {
  usedTarget: true,
  targetCorrect: true,
  meaningCorrect: true,
  readingCorrect: null,
  explanationZh: '这里的动词正确表达了拒绝邀请的意思。',
  corrections: [],
  correctedSentence: challenge.referenceSentence,
  correctedFurigana: challenge.referenceFurigana,
  correctedTranslationZh: challenge.referenceTranslationZh,
};

function service(overrides: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    GEMINI_API_KEY: 'mock-gemini',
    DEEPSEEK_API_KEY: 'mock-deepseek',
    ...overrides,
  };
  return new VocabularyAiService(
    {
      get: (key: string, fallback?: string) => values[key] ?? fallback,
    } as ConfigService,
    {
      aiUsageRecord: {
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaService,
  );
}
function respond(body: unknown, status = 200) {
  request.mockResolvedValueOnce({
    ok: status < 400,
    status,
    text: () =>
      Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  });
}
function gemini(value: unknown) {
  respond({
    candidates: [
      {
        finishReason: 'STOP',
        content: { parts: [{ text: JSON.stringify(value) }] },
      },
    ],
  });
}
function deepseek(value: unknown) {
  respond({
    choices: [
      { finish_reason: 'stop', message: { content: JSON.stringify(value) } },
    ],
  });
}
function bodyAt(index = 0) {
  return JSON.parse(request.mock.calls[index][1].body as string) as {
    model?: string;
    response_format?: { type: string };
    generationConfig?: { responseMimeType: string };
    contents?: Array<{ parts: Array<{ text: string }> }>;
    messages?: Array<{ content: string }>;
  };
}

describe('VocabularyAiService (mocked HTTP only)', () => {
  beforeEach(() => jest.resetAllMocks());

  it('generates with Gemini defaults, sense context and optional grammar instructions', async () => {
    gemini(challenge);
    await expect(service().generate(input)).resolves.toEqual(challenge);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toContain(
      'models/gemini-3.5-flash:generateContent',
    );
    expect(bodyAt().generationConfig?.responseMimeType).toBe(
      'application/json',
    );
    const prompt = bodyAt().contents![0].parts[0].text;
    expect(prompt).toContain(JSON.stringify(input));
    expect(prompt).toContain('grammarId MUST be null');
    expect(prompt).toContain('romanization');
    expect(prompt).toContain('untrusted exercise data');
    expect(prompt).toContain(
      'reference MUST naturally use the target in its current sense',
    );
  });

  it('uses configured DeepSeek primary/model and falls back to Gemini', async () => {
    respond('temporarily unavailable', 503);
    gemini(challenge);
    await expect(
      service({
        AI_PRIMARY_PROVIDER: 'DEEPSEEK',
        DEEPSEEK_MODEL: 'custom-deepseek',
        GEMINI_MODEL: 'custom-gemini',
      }).generate(input),
    ).resolves.toEqual(challenge);
    expect(request.mock.calls[0][0]).toBe(
      'https://api.deepseek.com/chat/completions',
    );
    expect(bodyAt()).toMatchObject({
      model: 'custom-deepseek',
      response_format: { type: 'json_object' },
    });
    expect(request.mock.calls[1][0]).toContain(
      'models/custom-gemini:generateContent',
    );
  });

  it('uses DeepSeek with an unconfigured Gemini provider', async () => {
    deepseek(challenge);
    await expect(
      service({ GEMINI_API_KEY: undefined }).generate(input),
    ).resolves.toEqual(challenge);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toContain('api.deepseek.com');
  });

  it('uses Gemini with an unconfigured preferred DeepSeek provider', async () => {
    gemini(challenge);
    await expect(
      service({
        AI_PRIMARY_PROVIDER: 'DEEPSEEK',
        DEEPSEEK_API_KEY: undefined,
      }).generate(input),
    ).resolves.toEqual(challenge);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('fails retryably without configured providers and performs no HTTP', async () => {
    await expect(
      service({
        GEMINI_API_KEY: undefined,
        DEEPSEEK_API_KEY: undefined,
      }).generate(input),
    ).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED', retryable: true });
    expect(request).not.toHaveBeenCalled();
  });

  it('propagates non-retryable HTTP failures without fallback', async () => {
    respond('invalid request', 400);
    await expect(service().generate(input)).rejects.toMatchObject({
      code: 'AI_HTTP_400',
      retryable: false,
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each(['AI_TIMEOUT', 'AI_NETWORK_ERROR'])(
    'falls back after %s from the shared timeout helper',
    async (code) => {
      request.mockRejectedValueOnce(
        new ProviderError('request failed', code, true),
      );
      deepseek(challenge);
      await expect(service().generate(input)).resolves.toEqual(challenge);
    },
  );

  it.each([
    { promptZh: '请用断る表达。' },
    { meaningHintZh: '读音是ことわる。' },
    { grammarId: 'invented' },
    { chunks: ['不匹配', '内容'] },
    { referenceFurigana: '友達の誘いを断った。' },
    { referenceTranslationZh: 'I refused.' },
    {
      referenceSentence: 'すみませんが、できません。',
      referenceFurigana: 'すみませんが、できません。',
      chunks: ['すみませんが', 'できません'],
    },
  ])('rejects invalid challenge fields and falls back: %j', async (invalid) => {
    gemini({ ...challenge, ...invalid });
    deepseek(challenge);
    await expect(service().generate(input)).resolves.toEqual(challenge);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each(['not json', '{}', '{"candidates":[]}'])(
    'treats malformed envelopes as retryable: %s',
    async (invalid) => {
      respond(invalid);
      respond({ choices: [] });
      await expect(service().generate(input)).rejects.toMatchObject({
        code: 'AI_INVALID_RESPONSE',
        retryable: true,
      });
    },
  );

  it('does not return a challenge if both providers leak the answer', async () => {
    gemini({ ...challenge, meaningHintZh: 'ことわる表示拒绝。' });
    deepseek({ ...challenge, promptZh: '请用断る回答。' });
    await expect(service().generate(input)).rejects.toMatchObject({
      code: 'AI_INVALID_RESPONSE',
      retryable: true,
    });
  });

  it('rejects truncated output even if the partial JSON parses', async () => {
    respond({
      candidates: [
        {
          finishReason: 'MAX_TOKENS',
          content: { parts: [{ text: JSON.stringify(challenge) }] },
        },
      ],
    });
    respond({
      choices: [
        {
          finish_reason: 'length',
          message: { content: JSON.stringify(challenge) },
        },
      ],
    });
    await expect(service().generate(input)).rejects.toMatchObject({
      code: 'AI_INVALID_RESPONSE',
    });
  });

  it('ignores thought parts and accepts fenced structured output', async () => {
    respond({
      candidates: [
        {
          content: {
            parts: [
              { thought: true, text: 'private reasoning' },
              { text: '```json\n' + JSON.stringify(challenge) + '\n```' },
            ],
          },
        },
      ],
    });
    await expect(service().generate(input)).resolves.toEqual(challenge);
  });

  it.each(['友達の誘いを断った。', '友達のさそいをことわった。'])(
    'preserves word evidence for conjugation/appropriate spelling: %s',
    async (answer) => {
      gemini(assessment);
      await expect(service().assess(input, challenge, answer)).resolves.toEqual(
        assessment,
      );
      const prompt = bodyAt().contents![0].parts[0].text;
      expect(prompt).toContain('legitimate conjugations');
      expect(prompt).toContain(
        'unrelated grammar errors must not lower a correct word result',
      );
      expect(prompt).toContain('readingCorrect MUST always be null');
      expect(prompt).toContain(JSON.stringify(answer));
    },
  );

  it('keeps natural alternate answers unverified and does not force a target correction', async () => {
    const alternate: WordAssessment = {
      ...assessment,
      usedTarget: false,
      targetCorrect: null,
      meaningCorrect: null,
      explanationZh: '表达自然，但没有使用目标词，无法验证该词的掌握情况。',
      correctedSentence: 'すみませんが、できません。',
      correctedFurigana: 'すみませんが、できません。',
      correctedTranslationZh: '抱歉，我办不到。',
    };
    gemini(alternate);
    await expect(
      service().assess(input, challenge, alternate.correctedSentence),
    ).resolves.toEqual(alternate);
  });

  it.each([
    { usedTarget: true, targetCorrect: false, meaningCorrect: false },
    { usedTarget: true, targetCorrect: null, meaningCorrect: null },
  ])('preserves wrong-sense or uncertain evidence: %j', async (evidence) => {
    gemini({ ...assessment, ...evidence });
    await expect(
      service().assess(input, challenge, '友達の誘いを断った。'),
    ).resolves.toMatchObject(evidence);
  });

  it.each([
    { targetCorrect: undefined, total_score: 100 },
    { targetCorrect: 'true' },
    { usedTarget: false },
    { meaningCorrect: null },
    { readingCorrect: true },
    { correctedFurigana: '友達の誘いを断った。' },
    { explanationZh: 'Correct target usage.' },
    {
      explanationZh:
        '表达自然，usedTarget=false,targetCorrect,meaningCorrect。',
    },
    {
      corrections: [
        { text: '存在しない', replacement: '修正', reason: '修改' },
      ],
    },
  ])(
    'rejects invalid assessments rather than inflating evidence: %j',
    async (invalid) => {
      gemini({ ...assessment, ...invalid });
      deepseek({ ...assessment, ...invalid });
      await expect(
        service().assess(input, challenge, challenge.referenceSentence),
      ).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE', retryable: true });
    },
  );

  it('permits actual grammar corrections while preserving correct target usage', async () => {
    const result = {
      ...assessment,
      corrections: [
        {
          text: '誘いが',
          replacement: '誘いを',
          reason: '宾语需要使用宾格助词，目标动词的词义正确。',
        },
      ],
    };
    gemini(result);
    await expect(
      service().assess(input, challenge, '友達の誘いが断った。'),
    ).resolves.toEqual(result);
  });

  it('accepts a historical challenge now present in previousPrompts', async () => {
    gemini(assessment);
    await expect(
      service().assess(
        { ...input, previousPrompts: [challenge.promptZh] },
        challenge,
        challenge.referenceSentence,
      ),
    ).resolves.toEqual(assessment);
  });

  it('rejects invalid caller inputs before contacting providers', async () => {
    await expect(
      service().generate({ ...input, senseKey: '' }),
    ).rejects.toThrow();
    await expect(service().assess(input, challenge, ' ')).rejects.toThrow();
    await expect(
      service().assess(input, challenge, 'あ'.repeat(301)),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it('matches main’s four-request 報告 integration contract with mocked responses', async () => {
    const reportInput: AiVocabularyInput = {
      word: '報告',
      reading: 'ほうこく',
      chineseGloss: '报告；汇报',
      senseKey: 'report',
      glosses: [{ language: 'eng', text: 'report; information' }],
      grammars: [
        {
          id: 'synthetic-n4-node',
          title: '〜ので',
          chineseExplanation: '表示原因或理由。',
        },
      ],
      previousPrompts: [],
    };
    const reportChallenge: Challenge = {
      promptZh: '调查结束了，请向上司说明你要汇报结果。',
      meaningHintZh: '把事情的情况或结果告诉相关的人。',
      grammarId: 'synthetic-n4-node',
      referenceSentence: '調査が終わったので、結果を報告します。',
      referenceFurigana:
        '調査[ちょうさ]が終[お]わったので、結果[けっか]を報告[ほうこく]します。',
      referenceTranslationZh: '因为调查结束了，所以我要汇报结果。',
      chunks: ['調査が', '終わったので', '結果を', '報告します'],
    };
    const ai = service();
    gemini(reportChallenge);
    await expect(ai.generate(reportInput)).resolves.toEqual(reportChallenge);
    for (const item of [
      {
        sentence: reportChallenge.referenceSentence,
        usedTarget: true,
        targetCorrect: true,
        meaningCorrect: true,
      },
      {
        sentence: 'おなかがすいたので、報告を食べました。',
        usedTarget: true,
        targetCorrect: false,
        meaningCorrect: false,
      },
      {
        sentence: '調査が終わったので、結果を伝えます。',
        usedTarget: false,
        targetCorrect: null,
        meaningCorrect: null,
      },
    ]) {
      const result: WordAssessment = {
        usedTarget: item.usedTarget,
        targetCorrect: item.targetCorrect,
        meaningCorrect: item.meaningCorrect,
        readingCorrect: null,
        explanationZh:
          item.targetCorrect === true
            ? '目标词正确表达了汇报调查结果。'
            : item.targetCorrect === false
              ? '不能把汇报作为吃的对象。'
              : '表达自然，但未使用目标词，无法验证掌握情况。',
        corrections:
          item.targetCorrect === false
            ? [
                {
                  text: '報告',
                  replacement: 'ご飯',
                  reason: '因为饿了而吃饭，不能把汇报作为吃的对象。',
                },
              ]
            : [],
        correctedSentence:
          item.targetCorrect === false
            ? 'おなかがすいたので、ご飯を食べました。'
            : item.usedTarget
              ? reportChallenge.referenceSentence
              : item.sentence,
        correctedFurigana:
          item.targetCorrect === false
            ? 'おなかがすいたので、ご飯[はん]を食[た]べました。'
            : item.usedTarget
              ? reportChallenge.referenceFurigana
              : '調査[ちょうさ]が終[お]わったので、結果[けっか]を伝[つた]えます。',
        correctedTranslationZh:
          item.targetCorrect === false
            ? '因为肚子饿了，所以吃了饭。'
            : reportChallenge.referenceTranslationZh,
      };
      gemini(result);
      await expect(
        ai.assess(reportInput, reportChallenge, item.sentence),
      ).resolves.toEqual(result);
      const prompt = bodyAt(request.mock.calls.length - 1).contents![0].parts[0]
        .text;
      expect(prompt).toContain('check every clause, causal relationship');
      expect(prompt).toContain('Never force the target into a correction');
      expect(prompt).toContain('NOT おなかがすいたので、報告をしました。');
      expect(prompt).toContain('Never expose JSON/API field names');
    }
    expect(request).toHaveBeenCalledTimes(4);
  });
});
