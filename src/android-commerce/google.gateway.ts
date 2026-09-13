import { Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import {
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  randomBytes,
  sign,
  verify,
  type JsonWebKey,
} from 'node:crypto';
import { z } from 'zod';
import { AndroidPolicy } from './android.policy';
import { billingError } from '../billing/billing.policy';
const money = z.object({
  currencyCode: z.string(),
  units: z.string().regex(/^\d+$/).default('0'),
  nanos: z.number().int().min(0).max(999999999).default(0),
});
export const playPurchase = z.object({
  productLineItem: z
    .array(
      z.object({
        productId: z.string(),
        productOfferDetails: z
          .object({
            purchaseOptionId: z.string().optional(),
            offerId: z.string().optional(),
            quantity: z.number().int().optional(),
            consumptionState: z.string().optional(),
          })
          .optional(),
      }),
    )
    .default([]),
  purchaseStateContext: z.object({ purchaseState: z.string() }),
  testPurchaseContext: z.object({ fopType: z.string().optional() }).optional(),
  orderId: z.string().optional(),
  obfuscatedExternalAccountId: z.string().optional(),
  purchaseCompletionTime: z.string().optional(),
  regionCode: z.string().optional(),
});
export const playOrder = z.object({
  orderId: z.string(),
  purchaseToken: z.string(),
  state: z.string(),
  lastEventTime: z.string(),
  createTime: z.string(),
  total: money,
  lineItems: z.array(z.object({ productId: z.string() })),
  orderHistory: z
    .object({
      partialRefundEvents: z
        .array(
          z.object({
            state: z.string(),
            refundDetails: z.object({ total: money }),
          }),
        )
        .optional(),
    })
    .optional(),
});
export type PlayPurchase = z.infer<typeof playPurchase>;
export type PlayOrder = z.infer<typeof playOrder>;

@Injectable()
export class GoogleGateway {
  private access?: { token: string; until: number };
  private certs?: { keys: JsonWebKey[]; until: number };
  constructor(private readonly policy: AndroidPolicy) {}
  private encryptionKey() {
    const raw = this.policy.config.get<string>(
      'GOOGLE_PLAY_TOKEN_ENCRYPTION_KEY',
    );
    if (!raw || !/^[a-fA-F0-9]{64}$/.test(raw))
      billingError('GOOGLE_TOKEN_KEY_UNAVAILABLE', 503);
    return Buffer.from(raw, 'hex');
  }
  encrypt(token: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    cipher.setAAD(
      Buffer.from(`v1:${this.policy.packageName}:${this.policy.environment}`),
    );
    const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return [
      'v1',
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      data.toString('base64url'),
    ].join('.');
  }
  decrypt(envelope: string) {
    const [version, iv, tag, data, ...extra] = envelope.split('.');
    if (version !== 'v1' || extra.length || !iv || !tag || !data)
      throw new Error('GOOGLE_TOKEN_ENVELOPE_INVALID');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey(),
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAAD(
      Buffer.from(`v1:${this.policy.packageName}:${this.policy.environment}`),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
  private async accessToken() {
    if (this.access && this.access.until > Date.now()) return this.access.token;
    const file = this.policy.config.get<string>('GOOGLE_PLAY_CREDENTIALS_FILE');
    if (!file) throw new Error('GOOGLE_CREDENTIALS_UNAVAILABLE');
    const credentials = z
      .object({
        type: z.literal('service_account'),
        client_email: z.string().email(),
        private_key: z.string(),
      })
      .parse(JSON.parse(await readFile(file, 'utf8')));
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const body = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: credentials.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
    const assertion = `${body}.${sign('RSA-SHA256', Buffer.from(body), credentials.private_key).toString('base64url')}`;
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('GOOGLE_AUTH_UNAVAILABLE');
    const token = z
      .object({ access_token: z.string(), expires_in: z.number() })
      .parse(await response.json());
    this.access = {
      token: token.access_token,
      until: Date.now() + Math.max(0, token.expires_in - 60) * 1000,
    };
    return token.access_token;
  }
  private async request(path: string, method = 'GET') {
    this.policy.assertIsolation();
    const token = await this.accessToken();
    const response = await fetch(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(this.policy.packageName)}/${path}`,
      {
        method,
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) throw new Error(`GOOGLE_API_${response.status}`);
    if (method === 'POST') return null;
    return response.json() as Promise<unknown>;
  }
  async purchase(token: string) {
    return playPurchase.parse(
      await this.request(
        `purchases/productsv2/tokens/${encodeURIComponent(token)}`,
      ),
    );
  }
  async order(id: string) {
    return playOrder.parse(
      await this.request(`orders/${encodeURIComponent(id)}`),
    );
  }
  async consume(productId: string, token: string) {
    await this.request(
      `purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}:consume`,
      'POST',
    );
  }
  async voided(start: number | undefined, end: number, pageToken?: string) {
    const query = new URLSearchParams({
      endTime: String(end),
      includeQuantityBasedPartialRefund: 'true',
      type: '0',
    });
    if (start !== undefined) query.set('startTime', String(start));
    if (pageToken) query.set('token', pageToken);
    return z
      .object({
        voidedPurchases: z
          .array(
            z.object({
              purchaseToken: z.string(),
              orderId: z.string().optional(),
              voidedTimeMillis: z.string().optional(),
            }),
          )
          .default([]),
        tokenPagination: z
          .object({ nextPageToken: z.string().optional() })
          .optional(),
      })
      .parse(await this.request(`purchases/voidedpurchases?${query}`));
  }
  async verifyPush(header: string | undefined) {
    if (!header?.startsWith('Bearer ')) billingError('INVALID_RTDN_AUTH', 401);
    const jwt = header.slice(7);
    if (jwt.length > 8192) billingError('INVALID_RTDN_AUTH', 401);
    try {
      const parts = jwt.split('.');
      if (parts.length !== 3) throw new Error();
      const head = z
        .object({ alg: z.literal('RS256'), kid: z.string() })
        .parse(JSON.parse(Buffer.from(parts[0], 'base64url').toString()));
      if (
        !this.certs ||
        this.certs.until <= Date.now() ||
        !this.certs.keys.some((k) => k.kid === head.kid)
      ) {
        const result = await fetch(
          'https://www.googleapis.com/oauth2/v3/certs',
          { signal: AbortSignal.timeout(5000) },
        );
        if (!result.ok) throw new Error();
        this.certs = {
          keys: ((await result.json()) as { keys: JsonWebKey[] }).keys,
          until: Date.now() + 60 * 60_000,
        };
      }
      const jwk = this.certs.keys.find((k) => k.kid === head.kid);
      if (!jwk) throw new Error();
      if (
        !verify(
          'RSA-SHA256',
          Buffer.from(`${parts[0]}.${parts[1]}`),
          createPublicKey({ key: jwk, format: 'jwk' }),
          Buffer.from(parts[2], 'base64url'),
        )
      )
        throw new Error();
      const claim = z
        .object({
          iss: z.enum(['accounts.google.com', 'https://accounts.google.com']),
          aud: z.string(),
          exp: z.number(),
          iat: z.number(),
          email: z.string(),
          email_verified: z.literal(true),
        })
        .parse(JSON.parse(Buffer.from(parts[1], 'base64url').toString()));
      if (
        claim.aud !== this.policy.config.get('GOOGLE_RTDN_AUDIENCE') ||
        claim.email !==
          this.policy.config.get('GOOGLE_RTDN_SERVICE_ACCOUNT_EMAIL') ||
        claim.exp * 1000 <= Date.now() ||
        claim.iat * 1000 > Date.now() + 60_000
      )
        throw new Error();
    } catch {
      billingError('INVALID_RTDN_AUTH', 401);
    }
  }
}
