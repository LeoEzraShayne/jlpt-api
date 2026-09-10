import { AiWorkerService } from './ai-worker.service';

const scenario = {
  version: 'scenario-v1',
  id: 'work',
  scenarioId: 'work',
  taskId: 'work-request',
  objectiveId: 'REQUEST_HELP',
  domain: 'WORK',
  objective: 'REQUEST_HELP',
  register: 'POLITE',
  promptZh: '向同事请求帮助',
};
const trainingContext = {
  version: 'training-v1',
  instructionZh: '独立表达',
  scenario,
  words: [],
  supportingGrammar: null,
  expressions: [],
  phrases: [],
};
function setup(context: unknown, sceneId: string | null = 'work') {
  const job = {
    id: 'job1',
    retryCount: 0,
    attempt: {
      userId: 'u1',
      studySessionId: 's1',
      sentence: '手伝ってくれませんか。',
      scene: '用户自由文字',
      studySession: {
        trainingContext: context,
        scenarioId: sceneId,
        trainingMode: 'TRANSFER',
      },
      grammar: {
        level: 'N3',
        title: '〜くれませんか',
        chineseExplanation: '请求帮助',
        examples: [],
      },
    },
  };
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'job1' }]),
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    aiReviewJob: {
      findUnique: jest.fn().mockResolvedValue(job),
      update: jest.fn().mockResolvedValue({}),
    },
    aiReviewResult: { create: jest.fn().mockResolvedValue({}) },
  };
  const reviews = {
    review: jest.fn().mockResolvedValue({
      provider: 'DEEPSEEK',
      response: {
        model: 'fixture',
        latencyMs: 1,
        usage: {},
        result: {
          total_score: 100,
          used_target_grammar: true,
          target_grammar_correct: true,
          content_response: '你提出了帮助请求。',
          next_practice: '下次向店员确认信息。',
          diversity_advice: '改变表达目的。',
          scenario_task_completed: true,
          alternative_sentence: '手伝ってくれませんか。',
        },
      },
    }),
  };
  const scenes = {
    recordUsed: jest.fn().mockRejectedValue(new Error('offline exposure')),
  };
  const worker = new AiWorkerService(
    prisma as never,
    reviews as never,
    { get: () => true } as never,
    scenes as never,
  );
  return { worker, prisma, reviews, scenes };
}
describe('AI worker scenario persistence', () => {
  it('passes persisted scene to provider, stores four parts and preserves completed result on exposure failure', async () => {
    const { worker, prisma, reviews } = setup(trainingContext);
    await worker.poll();
    expect(reviews.review).toHaveBeenCalledWith(
      expect.objectContaining({ trainingContext, trainingMode: 'TRANSFER' }),
    );
    const data = (
      prisma.aiReviewResult.create.mock.calls[0] as unknown as [
        { data: Record<string, unknown> },
      ]
    )[0].data;
    expect(data).toMatchObject({
      scenarioTaskCompleted: true,
      contentResponse: '你提出了帮助请求。',
      nextPractice: '下次向店员确认信息。',
      diversityAdvice: '改变表达目的。',
      totalScore: 100,
    });
    expect(prisma.aiReviewJob.update).toHaveBeenCalledTimes(1);
  });
  it.each([null, { scenario: { promptZh: '用户声称通过' } }])(
    'does not create proof from missing or malformed server context: %o',
    async (context) => {
      const { worker, prisma } = setup(context);
      await worker.poll();
      const data = (
        prisma.aiReviewResult.create.mock.calls[0] as unknown as [
          { data: Record<string, unknown> },
        ]
      )[0].data;
      expect(data.scenarioTaskCompleted).toBeNull();
    },
  );
  it('does not accept a context whose scenario disagrees with the session', async () => {
    const { worker, prisma } = setup(trainingContext, 'other');
    await worker.poll();
    const data = (
      prisma.aiReviewResult.create.mock.calls[0] as unknown as [
        { data: Record<string, unknown> },
      ]
    )[0].data;
    expect(data.scenarioTaskCompleted).toBeNull();
  });
});
