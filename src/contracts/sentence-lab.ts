/** Shared v1 contract. Main-agent owned. */
export type AppLocale = 'zh' | 'en';
export type BillingMarket = 'JP' | 'GLOBAL';
export type ProductCode = 'DAY_PASS' | 'YEAR_PASS';
export type TaskKind = 'GRAMMAR' | 'VOCABULARY';
export interface CatalogProduct {
  productCode: ProductCode; currency: 'USD' | 'JPY'; amount: number;
  durationSeconds: number; launchPrice: boolean;
}
export interface Catalog {
  market: BillingMarket; salesEnabled: boolean; launchAt: string | null;
  launchEndsAt: string | null; products: CatalogProduct[];
}
export interface MembershipSummary {
  isMember: boolean; expiresAt: string | null; salesEnabled: boolean;
  quota: { dailyLimit: number; consumed: number; reserved: number; remaining: number;
    rewardBalance: number; resetsAt: string; timezone: string; enforcementEnabled: boolean };
}
export interface OrderSummary {
  id: string; provider: string; productCode: ProductCode; currency: string;
  amount: number; durationSeconds: number; status: string; createdAt: string;
  paidAt: string | null; refundedAmount: number;
}
