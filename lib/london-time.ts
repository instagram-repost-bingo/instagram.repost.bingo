// "Today" for the draw history is the calendar date in London, where the bot
// runs the draw. The UK switches between GMT (winter) and BST (summer), so the
// date comes from Intl with the Europe/London time zone, never from UTC.

import { DRAW_TIME_ZONE } from "./config";

/** A calendar date as YYYY-MM-DD (the format of `draws.date`). */
export type DateKey = string;

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const londonDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: DRAW_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The London calendar date (YYYY-MM-DD) for an instant. */
export function londonDateKey(instant: Date): DateKey {
  if (Number.isNaN(instant.getTime())) throw new RangeError("Invalid date");
  const parts = Object.fromEntries(
    londonDate.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isDateKey(value: unknown): value is DateKey {
  if (typeof value !== "string") return false;
  const match = DATE_KEY_PATTERN.exec(value);
  if (!match) return false;
  const [y, m, d] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Calendar arithmetic on date keys (no time zone involved). */
export function addDays(dateKey: DateKey, days: number): DateKey {
  if (!isDateKey(dateKey)) throw new RangeError(`Invalid date key: ${dateKey}`);
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
