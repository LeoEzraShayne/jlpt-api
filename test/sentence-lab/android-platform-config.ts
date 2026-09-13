import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { z } from 'zod';

const schema = z
  .object({
    googleCredentialsFile: z.string().refine(isAbsolute).optional(),
    rtdnAudience: z.string().url().optional(),
    rtdnSubscription: z.string().optional(),
    rtdnServiceAccountEmail: z.string().email().optional(),
    admobAdUnitId: z
      .string()
      .regex(/^ca-app-pub-\d+\/\d+$/)
      .optional(),
    admobRewardItem: z.string().min(1).max(100).default('jlpt_task'),
    admobTestDeviceConfirmed: z.boolean().default(false),
    admobSsvVerifierOnly: z.boolean().default(false),
  })
  .strict();

export async function platformConfig(path: string) {
  if (!isAbsolute(path)) throw new Error('ABSOLUTE_PLATFORM_CONFIG_REQUIRED');
  const stat = await lstat(path);
  if (
    !stat.isFile() ||
    (stat.mode & 0o077) !== 0 ||
    stat.uid !== process.getuid?.()
  )
    throw new Error('PRIVATE_PLATFORM_CONFIG_REQUIRED');
  const config = schema.parse(JSON.parse(await readFile(path, 'utf8')));
  const demo = 'ca-app-pub-3940256099942544/5224354917';
  const adUnit = config.admobAdUnitId ?? demo;
  if (
    adUnit !== demo &&
    !config.admobTestDeviceConfirmed &&
    !config.admobSsvVerifierOnly
  )
    throw new Error('ADMOB_TEST_DEVICE_CONFIRMATION_REQUIRED');
  return { ...config, adUnit };
}

/** Only provider verification endpoints; no general internet or AI requests. */
export function providerFetch(original: typeof fetch): typeof fetch {
  return (input, init) => {
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input
          : input.url,
    );
    const permitted =
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      ((url.hostname === 'oauth2.googleapis.com' &&
        url.pathname === '/token') ||
        (url.hostname === 'www.googleapis.com' &&
          url.pathname === '/oauth2/v3/certs') ||
        (url.hostname === 'www.gstatic.com' &&
          url.pathname === '/admob/reward/verifier-keys.json') ||
        (url.hostname === 'androidpublisher.googleapis.com' &&
          url.pathname.startsWith(
            '/androidpublisher/v3/applications/com.meritledger.app/',
          )));
    if (!permitted) throw new Error('PLATFORM_OUTBOUND_URL_FORBIDDEN');
    return original(input, { ...init, redirect: 'error' });
  };
}
