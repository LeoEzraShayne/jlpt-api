import { calendarDate, nextCalendarDate } from './study-plan-dates';

describe('calendar plan dates', () => {
  it('normalizes historical onboarding noon values without deferring the start to tomorrow', () => {
    const noon = new Date('2026-09-10T12:00:00Z');
    const today = new Date('2026-09-10T00:00:00Z');
    expect(calendarDate(noon)).toEqual(today);
    expect(noon < nextCalendarDate(today)).toBe(true);
    expect(new Date('2026-09-11T00:00:00Z') < nextCalendarDate(today)).toBe(
      false,
    );
  });
});
