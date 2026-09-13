import { launchOfferEndsAt } from './billing.policy';

test.each([
  ['2026-09-12T23:58:15.676Z', '2027-03-12T23:58:15.676Z'],
  ['2026-08-31T23:58:15.676Z', '2027-02-28T23:58:15.676Z'],
  ['2023-08-31T12:34:56.789Z', '2024-02-29T12:34:56.789Z'],
  ['2024-02-29T12:34:56.789Z', '2024-08-29T12:34:56.789Z'],
  ['2026-03-31T00:00:00.001Z', '2026-09-30T00:00:00.001Z'],
  ['2026-01-31T00:00:00.001Z', '2026-07-31T00:00:00.001Z'],
])(
  'six calendar months from %s ends at %s without moving launch',
  (from, to) => {
    const launchAt = new Date(from);
    expect(launchOfferEndsAt(launchAt).toISOString()).toBe(to);
    expect(launchAt.toISOString()).toBe(from);
  },
);
