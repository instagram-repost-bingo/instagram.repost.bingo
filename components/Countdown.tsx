"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { splitCountdown } from "@/lib/format";
import { nextLondonMidnight } from "@/lib/london-time";
import { BingoBall } from "./BingoBall";

// One shared 1-second clock. The snapshot is whole seconds, so it only
// changes (and re-renders) once per second.
function subscribe(onTick: () => void) {
  const timer = setInterval(onTick, 1000);
  return () => clearInterval(timer);
}
const nowInSeconds = () => Math.floor(Date.now() / 1000);
// The page shell is prerendered, so the server shows placeholders and the
// browser fills in the real time after hydration.
const noTimeOnServer = () => null;

/**
 * The bot's job is scheduled for 00:02, usually starts a few minutes late, and
 * retries at 00:32 and later if posting fails. These refreshes cover the first
 * hour and a half, then stop.
 */
const REFRESH_MINUTES_AFTER_MIDNIGHT = [3, 5, 8, 12, 20, 30, 45, 60, 90];

/** Counts down to the next draw at 00:00 UK time (handles GMT and BST). */
export function Countdown() {
  const router = useRouter();
  const seconds = useSyncExternalStore(subscribe, nowInSeconds, noTimeOnServer);

  const now = seconds === null ? null : new Date(seconds * 1000);
  const target = now ? nextLondonMidnight(now) : null;
  const parts = now && target ? splitCountdown(target.getTime() - now.getTime()) : null;

  // When midnight passes, the target moves on a day and the bot's result is on
  // its way. Refresh the page data at these times so it shows up by itself.
  const targetTime = target?.getTime() ?? null;
  const previousTarget = useRef<number | null>(null);
  useEffect(() => {
    if (targetTime === null) return;
    const previous = previousTarget.current;
    previousTarget.current = targetTime;
    if (previous === null || previous === targetTime) return;
    const timers = REFRESH_MINUTES_AFTER_MIDNIGHT.map((minutes) =>
      setTimeout(() => router.refresh(), minutes * 60_000),
    );
    return () => timers.forEach(clearTimeout);
  }, [targetTime, router]);

  const label = parts
    ? `Next draw in ${Number(parts.hours)} hours, ${Number(parts.minutes)} minutes and ${Number(parts.seconds)} seconds`
    : "Next draw at 00:00 UK time";

  return (
    <div className="countdown" role="timer" aria-label={label}>
      <BingoBall label={parts?.hours ?? "--"} caption="HRS" tone="accent" size="lg" />
      <span className="countdown__colon" aria-hidden="true">
        :
      </span>
      <BingoBall label={parts?.minutes ?? "--"} caption="MIN" tone="paper" size="lg" />
      <span className="countdown__colon" aria-hidden="true">
        :
      </span>
      <BingoBall label={parts?.seconds ?? "--"} caption="SEC" tone="ink" size="lg" />
    </div>
  );
}
