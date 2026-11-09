// Display helpers. Pure: safe on the server and the client.

import { DRAW_TIME_LABEL, POOL_DAYS } from "./config";
import { addDays, type DateKey } from "./london-time";

// Date keys are calendar dates, so format them as UTC midnight to avoid any shift.
const shortDate = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const longDate = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

const monthOnly = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });

function dateKeyToUtc(dateKey: DateKey): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** "Mon 9 Nov" */
export function formatShortDate(dateKey: DateKey): string {
  return shortDate.format(dateKeyToUtc(dateKey));
}

/** "Monday 9 November" */
export function formatLongDate(dateKey: DateKey): string {
  return longDate.format(dateKeyToUtc(dateKey));
}

/** "09", for the number on a bingo ball. */
export function dayOfMonth(dateKey: DateKey): string {
  return dateKey.slice(8, 10);
}

/** "NOV" */
export function monthAbbrev(dateKey: DateKey): string {
  return monthOnly.format(dateKeyToUtc(dateKey)).slice(0, 3).toUpperCase();
}

export function relativeDayLabel(dateKey: DateKey, todayKey: DateKey): "Today" | "Yesterday" | null {
  if (dateKey === todayKey) return "Today";
  if (dateKey === addDays(todayKey, -1)) return "Yesterday";
  return null;
}

/** "1 entry", "23 entries" */
export function formatEntryCount(count: number): string {
  return `${count.toLocaleString("en-GB")} ${count === 1 ? "entry" : "entries"}`;
}

/** Copy shown after a successful entry, naming the owner we found on Instagram. */
export function entryAcceptedMessage(username: string): string {
  return `You're in, @${username}! The draw is every day at ${DRAW_TIME_LABEL} UK time, and your post stays in the pool for ${POOL_DAYS} days. Good luck!`;
}
