/* eslint-disable @typescript-eslint/no-unsafe-member-access -- HTTP fixture identifiers are checked in PostgreSQL. */
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { startHarness, type Harness } from './harness';
import { reviewSession } from './review-fixtures';
import { AiWorkerService } from '../../src/ai/ai-worker.service';
import { ProviderError } from '../../src/ai/ai-provider';
import { claimReview } from '../../src/ai/review-job-lease';
import { jobInput, reviewJobInclude } from '../../src/ai/review-job-context';
import { QuotaService } from '../../src/billing/quota.service';
let h: Harness;
beforeAll(async () => {
  h = await startHarness();
  await h.prisma.billingConfig.create({
    data: { enforcementEnabled: true, enforcementAt: new Date(0) },
  });
});
afterAll(async () => h?.stop());
async function fixture() {
  const login = await h.login(`recovery-${randomUUID()}`);
  const session = await reviewSession(h, login.user.id);
  const created = await login.http
    .post('/sentence-reviews', {
      sessionId: session.id,
      sentence: '音楽を聞きながら歩きます。',
      requestKey: randomUUID(),
    })
    .expect(202);
  const id = created.body.data.reviewId as string;
  const reviews = {
    review: jest
      .fn()
      .mockRejectedValue(
        new ProviderError('Temporary outage', 'AI_HTTP_429', true),
      ),
  };
  const quota = h.app.get(QuotaService);
  const worker = new AiWorkerService(
    h.prisma,
    reviews as never,
    new ConfigService({ AI_WORKER_ENABLED: true }),
    undefined,
    quota,
  );
  const expire = () =>
    h.prisma.aiReviewJob.update({
      where: { id },
      data: { lockedAt: new Date(Date.now() - 180000) },
    });
  return { ...login, session, id, reviews, worker, quota, expire };
}

test('crash budget cleanup releases quota and preserves exactly one explicit manual recovery', async () => {
  const f = await fixture();
  for (let round = 1; round <= 3; round++) {
    expect(await claimReview(h.prisma)).toMatchObject({
      id: f.id,
      round,
      exhausted: false,
    });
    await f.expire();
  }
  await f.worker.poll();
  expect(f.reviews.review).not.toHaveBeenCalled();
  expect(
    await h.prisma.aiReviewJob.findUniqueOrThrow({ where: { id: f.id } }),
  ).toMatchObject({ status: 'FAILED', retryCount: 3 });
  const submission = await h.prisma.taskSubmission.findFirstOrThrow({
    where: { resultId: f.id },
  });
  expect(submission.status).toBe('FAILED');
  expect((await f.quota.summary(f.user.id)).quota).toMatchObject({
    reserved: 0,
    consumed: 0,
    remaining: 5,
  });

  await f.http.post(`/sentence-reviews/${f.id}/retry`).expect(201);
  expect((await f.quota.summary(f.user.id)).quota).toMatchObject({
    reserved: 1,
    consumed: 0,
  });
  await f.worker.poll();
  expect(f.reviews.review).toHaveBeenCalledTimes(1);
  expect(f.reviews.review).toHaveBeenCalledWith(
    expect.objectContaining({
      usageContext: expect.objectContaining({ attempt: 7 }) as unknown,
    }),
  );
  expect(
    await h.prisma.aiReviewJob.findUniqueOrThrow({ where: { id: f.id } }),
  ).toMatchObject({ status: 'FAILED', retryCount: 4 });
  expect((await f.quota.summary(f.user.id)).quota).toMatchObject({
    reserved: 0,
    consumed: 0,
    remaining: 5,
  });
  await f.http.post(`/sentence-reviews/${f.id}/retry`).expect(400);
  await f.worker.poll();
  expect(f.reviews.review).toHaveBeenCalledTimes(1);
  expect(
    await h.prisma.taskSubmission.count({ where: { resultId: f.id } }),
  ).toBe(1);
});

test('a paused old claimant retains its own call ordinals after another lease is admitted', async () => {
  const f = await fixture();
  const first = await claimReview(h.prisma);
  await f.expire();
  const second = await claimReview(h.prisma);
  const current = await h.prisma.aiReviewJob.findUniqueOrThrow({
    where: { id: f.id },
    include: reviewJobInclude,
  });
  expect(current.retryCount).toBe(2);
  expect(jobInput(current, first.round).usageContext?.attempt).toBe(1);
  expect(jobInput(current, second.round).usageContext?.attempt).toBe(3);
  await f.expire();
  await f.worker.poll();
  expect(
    await h.prisma.aiReviewJob.findUniqueOrThrow({ where: { id: f.id } }),
  ).toMatchObject({ status: 'FAILED', retryCount: 3 });
});
