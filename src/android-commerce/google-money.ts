import type { PlayOrder } from './google.gateway';
// Supported ISO 4217 currencies; exact exponents avoid floating point.
const zero = new Set(
  'BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX VND VUV XAF XOF XPF'.split(' '),
);
const three = new Set('BHD IQD JOD KWD LYD OMR TND'.split(' '));
const two = new Set(
  'AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CNY COP CRC CUP CVE CZK DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GTQ GYD HKD HNL HTG HUF IDR ILS INR IRR JMD KES KGS KHR KPW KYD KZT LAK LBP LKR LRD LSL MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD PAB PEN PGK PHP PKR PLN QAR RON RSD RUB SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TOP TRY TTD TWD TZS UAH USD UYU UZS VES WST XCD YER ZAR ZMW'.split(
    ' ',
  ),
);
export function moneyMinor(value: {
  currencyCode: string;
  units: string;
  nanos: number;
}) {
  const exponent = zero.has(value.currencyCode)
    ? 0
    : three.has(value.currencyCode)
      ? 3
      : two.has(value.currencyCode)
        ? 2
        : null;
  if (
    exponent === null ||
    !/^\d+$/.test(value.units) ||
    !Number.isInteger(value.nanos) ||
    value.nanos < 0 ||
    value.nanos >= 1e9
  )
    throw new Error('GOOGLE_MONEY_INVALID');
  const nano = BigInt(value.units) * 1_000_000_000n + BigInt(value.nanos);
  const divisor = 10n ** BigInt(9 - exponent);
  if (nano % divisor !== 0n) throw new Error('GOOGLE_MONEY_PRECISION');
  const minor = nano / divisor;
  if (minor > 2147483647n) throw new Error('GOOGLE_MONEY_OVERFLOW');
  return Number(minor);
}
export function orderRefund(order: PlayOrder, amount: number) {
  if (order.state === 'REFUNDED') return amount;
  let total = 0;
  for (const event of order.orderHistory?.partialRefundEvents ?? []) {
    if (event.state !== 'PROCESSED_SUCCESSFULLY') continue;
    if (event.refundDetails.total.currencyCode !== order.total.currencyCode)
      throw new Error('GOOGLE_REFUND_CURRENCY');
    total += moneyMinor(event.refundDetails.total);
    if (total > amount) throw new Error('GOOGLE_REFUND_AMOUNT');
  }
  return total;
}
export function timestampNanos(value: string) {
  const match =
    /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)$/.exec(
      value,
    );
  if (!match) throw new Error('GOOGLE_TIMESTAMP_INVALID');
  const millis = Date.parse(`${match[1]}${match[3]}`);
  if (!Number.isFinite(millis)) throw new Error('GOOGLE_TIMESTAMP_INVALID');
  return BigInt(millis) * 1_000_000n + BigInt((match[2] ?? '').padEnd(9, '0'));
}
