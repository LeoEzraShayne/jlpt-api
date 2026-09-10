import { splitActivityDays } from './study-session-ledger';

describe('activity day ledger windows', () => {
  it('splits the actual window across local midnight', () => {
    expect(
      splitActivityDays(
        new Date('2026-08-19T14:59:40Z'),
        new Date('2026-08-19T15:00:20Z'),
        'Asia/Tokyo',
      ),
    ).toEqual([
      { studyDate: new Date('2026-08-19T00:00:00Z'), activeSeconds: 20 },
      { studyDate: new Date('2026-08-20T00:00:00Z'), activeSeconds: 20 },
    ]);
  });
  it('caps resumed inactivity without dumping old session totals into today', () => {
    const parts = splitActivityDays(
      new Date('2026-07-01'),
      new Date('2026-08-20T00:00:00Z'),
      'Asia/Tokyo',
    );
    expect(parts).toEqual([
      { studyDate: new Date('2026-08-20T00:00:00Z'), activeSeconds: 90 },
    ]);
  });
  it('counts overlapping device intervals only after the global cursor', () => {
    expect(
      splitActivityDays(
        new Date('2026-08-20T00:00:00Z'),
        new Date('2026-08-20T00:01:00Z'),
        'Asia/Tokyo',
        new Date('2026-08-20T00:00:45Z'),
      )[0].activeSeconds,
    ).toBe(15);
    expect(
      splitActivityDays(
        new Date('2026-08-20T00:00:00Z'),
        new Date('2026-08-20T00:01:00Z'),
        'Asia/Tokyo',
        new Date('2026-08-20T00:01:00Z'),
      ),
    ).toEqual([]);
  });
  it('preserves elapsed seconds across DST transitions and rejects backwards clocks', () => {
    const parts = splitActivityDays(
      new Date('2026-11-01T05:59:30Z'),
      new Date('2026-11-01T06:00:30Z'),
      'America/New_York',
    );
    expect(parts[0].activeSeconds).toBe(60);
    expect(
      splitActivityDays(
        new Date('2026-08-21'),
        new Date('2026-08-20'),
        'Asia/Tokyo',
      ),
    ).toEqual([]);
  });
});
