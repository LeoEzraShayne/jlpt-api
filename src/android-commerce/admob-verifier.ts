import { Injectable } from '@nestjs/common';
import { createPublicKey, verify } from 'node:crypto';
import { z } from 'zod';
import { billingError } from '../billing/billing.policy';

/** Tink RewardedAdsVerifier uses URI.getQuery(): percent decode once, preserve '+'. */
export function parseSsv(query: string) {
  if (query.length > 16000 || query.includes('#'))
    throw new Error('INVALID_SSV_QUERY');
  const match = /^(.*)&signature=([^&]+)&key_id=([^&]+)$/.exec(query);
  if (!match) throw new Error('INVALID_SSV_QUERY');
  // Tink percent-decodes the URI query before reading these suffix values too.
  // Decode once only; the strict alphabet rejects remaining '%' and separators.
  const signature = decodeURIComponent(match[2]);
  const keyId = decodeURIComponent(match[3]);
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(signature) || !/^\d+$/.test(keyId))
    throw new Error('INVALID_SSV_QUERY');
  const fields: Record<string, string> = {};
  for (const part of match[1].split('&')) {
    const index = part.indexOf('=');
    const key = part.slice(0, index);
    if (
      index < 1 ||
      !/^[a-zA-Z0-9_]+$/.test(key) ||
      key === 'signature' ||
      key === 'key_id' ||
      Object.hasOwn(fields, key)
    )
      throw new Error('INVALID_SSV_QUERY');
    fields[key] = decodeURIComponent(part.slice(index + 1));
  }
  const decoded = decodeURIComponent(match[1]);
  // Encoded separators must not smuggle a second interpretation of a signed field.
  const decodedKeys = decoded.split('&').map((value) => value.split('=')[0]);
  if (new Set(decodedKeys).size !== decodedKeys.length)
    throw new Error('INVALID_SSV_QUERY');
  return {
    fields,
    bytes: Buffer.from(decoded, 'utf8'),
    signature: Buffer.from(signature, 'base64url'),
    keyId,
  };
}
@Injectable()
export class AdmobVerifier {
  private cache?: { keys: Map<string, string>; until: number };
  async key(id: string) {
    if (
      !this.cache ||
      this.cache.until <= Date.now() ||
      !this.cache.keys.has(id)
    ) {
      const response = await fetch(
        'https://www.gstatic.com/admob/reward/verifier-keys.json',
        { signal: AbortSignal.timeout(5000) },
      );
      if (!response.ok) throw new Error('SSV_KEYS_UNAVAILABLE');
      const data = z
        .object({
          keys: z
            .array(
              z.object({
                keyId: z.union([
                  z.number().int().safe(),
                  z.string().regex(/^\d+$/),
                ]),
                base64: z.string(),
              }),
            )
            .min(1),
        })
        .parse(await response.json());
      this.cache = {
        keys: new Map(data.keys.map((key) => [String(key.keyId), key.base64])),
        until: Date.now() + 23 * 60 * 60_000,
      };
    }
    const value = this.cache.keys.get(id);
    if (!value) throw new Error('SSV_KEY_UNKNOWN');
    return createPublicKey({
      key: Buffer.from(value, 'base64'),
      format: 'der',
      type: 'spki',
    });
  }
  async verify(query: string) {
    try {
      const parsed = parseSsv(query);
      if (
        !verify(
          'sha256',
          parsed.bytes,
          { key: await this.key(parsed.keyId), dsaEncoding: 'der' },
          parsed.signature,
        )
      )
        throw new Error('SSV_SIGNATURE_INVALID');
      return parsed.fields;
    } catch {
      billingError('INVALID_ADMOB_SIGNATURE', 400);
    }
  }
}
