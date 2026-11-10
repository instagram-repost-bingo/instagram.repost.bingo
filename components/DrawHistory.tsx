import { io } from "next/cache";
import { DRAW_TIME_LABEL } from "@/lib/config";
import {
  dayOfMonth,
  formatEntryCount,
  formatLongDate,
  formatShortDate,
  monthAbbrev,
  relativeDayLabel,
} from "@/lib/format";
import { loadHistory, type DrawSummary, type HistoryData } from "@/lib/history";
import type { DateKey } from "@/lib/london-time";
import { getDb } from "@/lib/mongodb";
import { BingoBall } from "./BingoBall";

/** Past draws shown straight away; older ones sit behind "Show older draws". */
const VISIBLE_PAST_DRAWS = 7;

/**
 * Streams in at request time (behind a Suspense boundary) so results and the
 * pool count are always current, while the rest of the page is a static shell.
 * Results come from the `draws` collection, written by the bot.
 */
export async function DrawHistory() {
  await io(); // reads the clock and the database: keep it out of the prerender

  let data: HistoryData;
  try {
    data = await loadHistory(getDb(), new Date());
  } catch (error) {
    console.error("[history] could not load draws", error);
    return (
      <p className="history__notice" role="status">
        The draw history is taking a quick break. Please refresh in a minute.
      </p>
    );
  }

  const { today, next, draws } = data;
  const recent = draws.slice(0, VISIBLE_PAST_DRAWS);
  const older = draws.slice(VISIBLE_PAST_DRAWS);

  return (
    <div className="history__lists">
      <ol className="draws">
        {/* Always first: the draw still to come. Results follow, newest first. */}
        <li className="draw draw--pending">
          <BingoBall label="?" caption="NEXT" tone="accent" />
          <div className="draw__body">
            <p className="draw__date">
              <strong>Next draw</strong>
            </p>
            <p className="draw__count">{formatEntryCount(next.poolSize)} in the pool</p>
            <p className="draw__status">
              <span className="pill">Tonight at {DRAW_TIME_LABEL}</span>
            </p>
          </div>
        </li>
        {recent.map((draw) => (
          <DrawRow key={draw.date} draw={draw} today={today} />
        ))}
      </ol>

      {older.length > 0 ? (
        <details className="history__older">
          <summary className="history__more">Show older draws ({older.length})</summary>
          <ol className="draws">
            {older.map((draw) => (
              <DrawRow key={draw.date} draw={draw} today={today} />
            ))}
          </ol>
        </details>
      ) : null}
    </div>
  );
}

function DrawRow({ draw, today }: { draw: DrawSummary; today: DateKey }) {
  const when = formatLongDate(draw.date);
  return (
    <li className="draw">
      <BingoBall label={dayOfMonth(draw.date)} caption={monthAbbrev(draw.date)} tone="paper" />
      <div className="draw__body">
        <p className="draw__date">
          <DateLabel date={draw.date} today={today} />
        </p>
        {draw.entryCount !== null ? <p className="draw__count">{formatEntryCount(draw.entryCount)}</p> : null}

        {draw.winnerUsername || draw.winnerUrl ? (
          <div className="draw__winner">
            <span className="draw__winner-label">Winner</span>
            {draw.winnerUsername ? (
              <a
                className="draw__username"
                href={`https://www.instagram.com/${draw.winnerUsername}/`}
                rel="ugc nofollow"
              >
                @{draw.winnerUsername}
              </a>
            ) : null}
          </div>
        ) : (
          <p className="draw__status draw__status--empty">No winner this day.</p>
        )}

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
      </div>
    </li>
  );
}

function DateLabel({ date, today }: { date: DateKey; today: DateKey }) {
  const relative = relativeDayLabel(date, today);
  return (
    <time dateTime={date}>
      {relative ? (
        <>
          <strong>{relative}</strong> {formatShortDate(date)}
        </>
      ) : (
        <strong>{formatShortDate(date)}</strong>
      )}
    </time>
  );
}

export function DrawHistorySkeleton() {
  return (
    <div className="draws draws--loading" aria-busy="true">
      <p className="visually-hidden" role="status">
        Loading the draw history
      </p>
      {[0, 1, 2].map((key) => (
        <div key={key} className="draw draw--skeleton" aria-hidden="true">
          <span className="ball ball--md ball--paper" />
          <div className="draw__body">
            <span className="skeleton-line skeleton-line--short" />
            <span className="skeleton-line" />
          </div>
        </div>
      ))}
    </div>
  );
}
