import type { ProductCode } from './sentence-lab';

export type AndroidClientId = 'android-release' | 'android-test';
export type AndroidEnvironment = 'live' | 'test';
export const ANDROID_SCOPES = [
  'commerce:read',
  'google:purchase',
  'admob:reward',
] as const;
export type AndroidScope = (typeof ANDROID_SCOPES)[number];
export const ANDROID_CALLBACK_PATHS: Record<AndroidClientId, string> = {
  'android-release': '/android/callback',
  'android-test': '/android/callback/test',
};
export const GOOGLE_PRODUCTS = {
  DAY_PASS: { productId: 'jlpt_day_pass', purchaseOptionId: 'buy' },
  YEAR_PASS: { productId: 'jlpt_year_pass', purchaseOptionId: 'buy' },
} as const;
export const GOOGLE_LAUNCH_OFFER = 'launch-64';

export interface AndroidBindingInput {
  clientId: AndroidClientId;
  codeChallenge: string;
  state: string;
}
export interface AndroidBindingCreated {
  bindingId: string;
  authorizationUrl: string;
  expiresAt: string;
}
export interface AndroidBindingDetails {
  clientId: AndroidClientId;
  expiresAt: string;
  scopes: readonly AndroidScope[];
}
export interface AndroidTokenResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresAt: string;
  scopes: readonly AndroidScope[];
  user: { id: string; displayName: string; email: string };
  googlePlayAccountId: string;
}
export interface AndroidCatalog {
  packageName: string;
  environment: AndroidEnvironment;
  salesEnabled: boolean;
  launchAt: string | null;
  launchEndsAt: string | null;
  products: {
    productCode: ProductCode;
    productId: string;
    purchaseOptionId: string;
    offerId: string | null;
    durationSeconds: number;
    launchPrice: boolean;
  }[];
}
export interface AndroidRewardTicket {
  ticketId: string;
  adUnitId: string;
  customData: string;
  ssvUserId: string;
  expiresAt: string;
}
