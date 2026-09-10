/** Plan start/target values are calendar dates, encoded at UTC midnight. */
export function calendarDate(value: Date) {
  return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

/** Exclusive boundary also accepts legacy plans saved at noon on the same day. */
export function nextCalendarDate(value: Date) {
  return new Date(calendarDate(value).getTime() + 86_400_000);
}
