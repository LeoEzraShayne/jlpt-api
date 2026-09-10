import { TimerPhase } from '@prisma/client';

export const FOCUS_MINUTES = 10;
export const BREAK_MINUTES = 10;

const MINUTE_MS = 60_000;
const FOCUS_MS = FOCUS_MINUTES * MINUTE_MS;
const BREAK_MS = BREAK_MINUTES * MINUTE_MS;
const CYCLE_MS = FOCUS_MS + BREAK_MS;

export type PersistedTimer = {
  timerPhase: TimerPhase;
  timerPhaseStartedAt: Date;
  timerPhaseEndsAt: Date;
};

export type StudyTimer = {
  phase: TimerPhase;
  phaseStartedAt: Date;
  phaseEndsAt: Date;
  focusMinutes: number;
  breakMinutes: number;
};

export function initialTimer(now = new Date()): PersistedTimer {
  return {
    timerPhase: TimerPhase.FOCUS,
    timerPhaseStartedAt: now,
    timerPhaseEndsAt: new Date(now.getTime() + FOCUS_MS),
  };
}

export function resolveTimer(
  state: PersistedTimer,
  now = new Date(),
): PersistedTimer {
  const endsAt = state.timerPhaseEndsAt.getTime();
  if (now.getTime() < endsAt) return state;

  if (state.timerPhase === TimerPhase.FOCUS) {
    const elapsedAfterFocus = now.getTime() - endsAt;
    if (elapsedAfterFocus < BREAK_MS)
      return timerState(TimerPhase.BREAK, endsAt, BREAK_MS);
    return resolveFromCycleStart(
      endsAt + BREAK_MS,
      elapsedAfterFocus - BREAK_MS,
    );
  }

  return resolveFromCycleStart(endsAt, now.getTime() - endsAt);
}

export function presentTimer(state: PersistedTimer): StudyTimer {
  return {
    phase: state.timerPhase,
    phaseStartedAt: state.timerPhaseStartedAt,
    phaseEndsAt: state.timerPhaseEndsAt,
    focusMinutes: FOCUS_MINUTES,
    breakMinutes: BREAK_MINUTES,
  };
}

function resolveFromCycleStart(cycleAnchor: number, elapsed: number) {
  const cycleOffset = elapsed % CYCLE_MS;
  const cycleStart = cycleAnchor + elapsed - cycleOffset;
  if (cycleOffset < FOCUS_MS)
    return timerState(TimerPhase.FOCUS, cycleStart, FOCUS_MS);
  return timerState(TimerPhase.BREAK, cycleStart + FOCUS_MS, BREAK_MS);
}

function timerState(
  timerPhase: TimerPhase,
  startedAtMs: number,
  durationMs: number,
): PersistedTimer {
  return {
    timerPhase,
    timerPhaseStartedAt: new Date(startedAtMs),
    timerPhaseEndsAt: new Date(startedAtMs + durationMs),
  };
}
