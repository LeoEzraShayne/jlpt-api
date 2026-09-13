import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { platformConfig, providerFetch } from './android-platform-config';

test('platform configuration requires private local regular file and an explicit test-device declaration for owned ad units', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jlpt-platform-config-test-'));
  const path = join(directory, 'platform.json');
  try {
    await writeFile(path, '{}', { mode: 0o600 });
    expect((await platformConfig(path)).adUnit).toContain('3940256099942544');
    await writeFile(
      path,
      JSON.stringify({ admobAdUnitId: 'ca-app-pub-123/456' }),
    );
    await expect(platformConfig(path)).rejects.toThrow(
      'ADMOB_TEST_DEVICE_CONFIRMATION_REQUIRED',
    );
    await writeFile(
      path,
      JSON.stringify({
        admobAdUnitId: 'ca-app-pub-123/456',
        admobSsvVerifierOnly: true,
      }),
    );
    expect((await platformConfig(path)).admobTestDeviceConfirmed).toBe(false);
    await writeFile(
      path,
      JSON.stringify({
        admobAdUnitId: 'ca-app-pub-123/456',
        admobTestDeviceConfirmed: true,
      }),
    );
    expect((await platformConfig(path)).adUnit).toBe('ca-app-pub-123/456');
    await chmod(path, 0o644);
    await expect(platformConfig(path)).rejects.toThrow(
      'PRIVATE_PLATFORM_CONFIG_REQUIRED',
    );
    await chmod(path, 0o600);
    const link = join(directory, 'link.json');
    await symlink(path, link);
    await expect(platformConfig(link)).rejects.toThrow(
      'PRIVATE_PLATFORM_CONFIG_REQUIRED',
    );
    await writeFile(path, JSON.stringify({ BILLING_ENVIRONMENT: 'live' }));
    await expect(platformConfig(path)).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('provider allowlist rejects unrelated hosts, wrong package, embedded credentials and redirects', async () => {
  const transport = jest.fn().mockResolvedValue(new Response('{}'));
  const fetch = providerFetch(transport);
  for (const url of [
    'https://api.jlpt.meritledger.org/api/v1/health',
    'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/other.app/orders/order',
    'http://oauth2.googleapis.com/token',
    'https://user@oauth2.googleapis.com/token',
    'https://oauth2.googleapis.com:444/token',
  ])
    expect(() => fetch(url)).toThrow('PLATFORM_OUTBOUND_URL_FORBIDDEN');
  await fetch('https://oauth2.googleapis.com/token', { method: 'POST' });
  expect(transport).toHaveBeenCalledWith(
    'https://oauth2.googleapis.com/token',
    { method: 'POST', redirect: 'error' },
  );
});
