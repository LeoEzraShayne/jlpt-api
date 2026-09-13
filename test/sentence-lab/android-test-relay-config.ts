import { lstat, readFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { ConfigService } from '@nestjs/config';
import { AndroidPolicy } from '../../src/android-commerce/android.policy';

export function relayIsolationConfig(databaseName: unknown) {
  if (
    typeof databaseName !== 'string' ||
    !/^jlpt_f_acceptance_test_\d+_[a-f0-9]+$/.test(databaseName)
  )
    throw new Error('RELAY_ISOLATED_DATABASE_REQUIRED');
  const config = new ConfigService({
    DATABASE_URL: `postgres://${encodeURIComponent(userInfo().username)}@localhost:5432/${databaseName}`,
    BILLING_ENVIRONMENT: 'test',
    ANDROID_COMMERCE_ENVIRONMENT: 'test',
    GOOGLE_PLAY_PACKAGE_NAME: 'com.meritledger.app',
  });
  new AndroidPolicy(config).assertIsolation();
  return config;
}

export async function readRelayIsolationConfig(path: string) {
  const stat = await lstat(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    stat.uid !== process.getuid?.()
  )
    throw new Error('RELAY_PRIVATE_STATE_REQUIRED');
  const state = JSON.parse(await readFile(path, 'utf8')) as {
    databaseName?: unknown;
  };
  return relayIsolationConfig(state.databaseName);
}
