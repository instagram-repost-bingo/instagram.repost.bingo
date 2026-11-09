import { io } from "next/cache";
import { formatEntryCount, formatLongDate, formatShortDate } from "@/lib/format";
import { loadLatestDraw, type DrawSummary } from "@/lib/history";
import { addDays, londonDateKey } from "@/lib/london-time";
import { getDb } from "@/lib/mongodb";

/** Always shows the most recent result. Streams in at request time. */
export async function LastWinner() {
  await io(); // reads the clock and the database: keep it out of the prerender

  const now = new Date();
  let draw: DrawSummary | null;
  try {
    draw = await loadLatestDraw(getDb(), now);
  } catch (error) {
    console.error("[winner] could not load the latest draw", error);
    return (
      <>
        <h2 className="draw-panel__title">Last night&apos;s winner</h2>
        <p className="draw-panel__note">The winner is taking a quick break. Please refresh in a minute.</p>
      </>
    );
  }

  if (!draw) {
    return (
      <>
        <h2 className="draw-panel__title">Last night&apos;s winner</h2>
        <p className="draw-panel__empty">No winner yet. The first draw is at midnight.</p>
      </>
    );
  }

  const today = londonDateKey(now);
  const recent = draw.date === today || draw.date === addDays(today, -1);
  const when = formatLongDate(draw.date);

  return (
    <>
      <h2 className="draw-panel__title">{recent ? "Last night's winner" : "Latest winner"}</h2>
      {draw.winnerUsername ? (
        <p className="draw-panel__winner">
          <a href={`https://www.instagram.com/${draw.winnerUsername}/`} rel="ugc nofollow">
            @{draw.winnerUsername}
          </a>
        </p>
      ) : (
        <p className="draw-panel__empty">No entries, so no winner.</p>
      )}
      <p className="draw-panel__note">
        <time dateTime={draw.date}>{formatShortDate(draw.date)}</time>
        {draw.entryCount !== null ? ` · picked from ${formatEntryCount(draw.entryCount)}` : ""}
      </p>
      {draw.winnerUrl || draw.resultPostUrl ? (
        <p className="draw__links">
          {draw.winnerUrl ? (
            <a
              className="draw__link"
              href={draw.winnerUrl}
              rel="ugc nofollow"
              aria-label={`Winning post${draw.winnerUsername ? ` by @${draw.winnerUsername}` : ""}, ${when}`}
            >
              Winning post
            </a>
          ) : null}
          {draw.resultPostUrl ? (
            <a className="draw__link" href={draw.resultPostUrl} aria-label={`Result post for ${when}`}>
              Result post
            </a>
          ) : null}
        </p>
      ) : null}
    </>
  );
}

export function LastWinnerSkeleton() {
  return (
    <div aria-busy="true">
      <p className="visually-hidden" role="status">
        Loading the latest winner
      </p>
      <span className="skeleton-line skeleton-line--short" aria-hidden="true" />
      <span className="skeleton-line" aria-hidden="true" />
    </div>
  );
}
