import { TimerPhase } from '@prisma/client';
import {
  BREAK_MINUTES,
  FOCUS_MINUTES,
  initialTimer,
  presentTimer,
  resolveTimer,
} from './study-timer';

const minute = 60_000;
const anchor = new Date('2026-08-09T00:00:00.000Z');

describe('study timer', () => {
  it('starts with a 10 minute focus phase', () => {
    const timer = initialTimer(anchor);
    expect(timer.timerPhase).toBe(TimerPhase.FOCUS);
    expect(timer.timerPhaseStartedAt).toEqual(anchor);
    expect(timer.timerPhaseEndsAt).toEqual(
      new Date(anchor.getTime() + FOCUS_MINUTES * minute),
    );
  });

  it('advances from focus to a 10 minute break', () => {
    const timer = resolveTimer(
      initialTimer(anchor),
      new Date(anchor.getTime() + 11 * minute),
    );
    expect(timer.timerPhase).toBe(TimerPhase.BREAK);
    expect(timer.timerPhaseEndsAt).toEqual(
      new Date(anchor.getTime() + (FOCUS_MINUTES + BREAK_MINUTES) * minute),
    );
  });

  it('resolves multiple missed cycles from server time', () => {
    const timer = resolveTimer(
      initialTimer(anchor),
      new Date(anchor.getTime() + 2 * 20 * minute + 15 * minute),
    );
    expect(timer.timerPhase).toBe(TimerPhase.BREAK);
    expect(timer.timerPhaseStartedAt).toEqual(
      new Date(anchor.getTime() + 2 * 20 * minute + 10 * minute),
    );
  });

  it('presents stable public durations', () => {
    expect(presentTimer(initialTimer(anchor))).toMatchObject({
      phase: TimerPhase.FOCUS,
      focusMinutes: 10,
      breakMinutes: 10,
    });
  });
});
