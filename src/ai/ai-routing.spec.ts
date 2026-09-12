/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- Assert exact mock argument sequences. */
import { ConfigService } from '@nestjs/config';
import { routeAi } from './ai-routing';
import { ProviderError } from './ai-provider';
import { geminiCircuitKey } from './gemini-free-circuit';
const providers = [{ name: 'DEEPSEEK' as const }, { name: 'GEMINI' as const }];
const config = () =>
  new ConfigService({
    GEMINI_FREE_FIRST: true,
    GEMINI_API_KEY: 'synthetic-key',
    GEMINI_MODEL: 'gemini-3.8-flash',
  });
const gate = () => ({
  acquire: jest.fn().mockResolvedValue({ key: 'hash', token: 'lease' }),
  release: jest.fn().mockResolvedValue(undefined),
});
it.each([
  'AI_INVALID_RESPONSE',
  'AI_HTTP_429',
  'AI_HTTP_404',
  'AI_HTTP_403',
  'AI_NETWORK_ERROR',
  'AI_LOCALE_MISMATCH',
])('uses one Gemini candidate then qualified DS for %s', async (code) => {
  const circuit = gate();
  const op = jest
    .fn()
    .mockRejectedValueOnce(new ProviderError('safe', code, true))
    .mockResolvedValueOnce('ds-valid');
  await expect(
    routeAi(providers, op, config(), undefined, circuit),
  ).resolves.toEqual({ provider: providers[0], response: 'ds-valid' });
  expect(op.mock.calls.map((c) => [c[0].name, c[1]])).toEqual([
    ['GEMINI', 0],
    ['DEEPSEEK', 1],
  ]);
  expect(circuit.release).toHaveBeenCalledTimes(1);
});
it('does not add repair after second-slot DS failure', async () => {
  const final = new ProviderError('ds invalid', 'AI_INVALID_RESPONSE', true);
  const op = jest
    .fn()
    .mockRejectedValueOnce(new ProviderError('quota', 'AI_HTTP_429', true))
    .mockRejectedValueOnce(final);
  await expect(
    routeAi(providers, op, config(), undefined, gate()),
  ).rejects.toBe(final);
  expect(op).toHaveBeenCalledTimes(2);
});
it('retains two DS repair slots when Gemini is cooling/busy', async () => {
  const circuit = gate();
  circuit.acquire.mockResolvedValueOnce(null);
  const op = jest
    .fn()
    .mockRejectedValueOnce(
      new ProviderError('invalid', 'AI_INVALID_RESPONSE', true),
    )
    .mockResolvedValueOnce('valid');
  await routeAi(providers, op, config(), undefined, circuit);
  expect(op.mock.calls.map((c) => c[0].name)).toEqual(['DEEPSEEK', 'DEEPSEEK']);
  expect(op.mock.calls[1][2]).toContain('strict structural');
});
it('does not fall back after metering failure or consume a third network slot', async () => {
  const error = new ProviderError('meter', 'AI_METERING_UNAVAILABLE', false);
  const op = jest.fn().mockRejectedValue(error);
  await expect(
    routeAi(providers, op, config(), undefined, gate()),
  ).rejects.toBe(error);
  expect(op).toHaveBeenCalledTimes(1);
});
it('never admits free-only mode without qualified fallback', async () => {
  const op = jest.fn();
  await expect(
    routeAi([providers[1]], op, config(), undefined, gate()),
  ).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
  expect(op).not.toHaveBeenCalled();
});
it('flag false preserves existing primary and same-provider repair', async () => {
  const op = jest.fn().mockResolvedValue('valid');
  const circuit = gate();
  await routeAi(
    providers,
    op,
    new ConfigService({ GEMINI_FREE_FIRST: 'false' }),
    undefined,
    circuit,
  );
  expect(op.mock.calls[0][0].name).toBe('DEEPSEEK');
  expect(circuit.acquire).not.toHaveBeenCalled();
});
it('fingerprints credentials without persisting plaintext and separates models', () => {
  const key = geminiCircuitKey('never-store-key', 'model');
  expect(key).not.toContain('never-store-key');
  expect(key).not.toBe(geminiCircuitKey('other', 'model'));
  expect(key).not.toBe(geminiCircuitKey('never-store-key', 'other'));
});
