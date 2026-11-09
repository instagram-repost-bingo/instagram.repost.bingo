import { io } from "next/cache";
import { DRAW_TIME_LABEL, POOL_DAYS } from "@/lib/config";
import { loadPool, type PoolData } from "@/lib/history";
import { getDb } from "@/lib/mongodb";

/**
 * Public list of everyone in the pool for the next draw, newest first.
 * Streams in at request time, like the history.
 */
export async function WhoIsIn() {
  await io(); // reads the clock and the database: keep it out of the prerender

  let pool: PoolData;
  try {
    pool = await loadPool(getDb(), new Date());
  } catch (error) {
    console.error("[pool] could not load entries", error);
    return (
      <p className="history__notice" role="status">
        The list of entries is taking a quick break. Please refresh in a minute.
      </p>
    );
  }

  const hidden = pool.total - pool.entries.length;

  return (
    <div className="pool__body">
      <p className="pool__count">
        <span className="pill">
          {pool.total.toLocaleString("en-GB")} {pool.total === 1 ? "post" : "posts"}
        </span>{" "}
        in the pool for the next draw at {DRAW_TIME_LABEL}.
      </p>
      {pool.entries.length > 0 ? (
        <ul className="pool__list">
          {pool.entries.map((entry) => (
            <li key={entry.url}>
              <a
                className="pool__entrant"
                href={entry.url}
                rel="ugc nofollow"
                aria-label={`Post by @${entry.username}`}
              >
                @{entry.username}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="pool__empty">Nobody yet. Be the first!</p>
      )}
      {hidden > 0 ? (
        <p className="pool__more">and {hidden.toLocaleString("en-GB")} more</p>
      ) : null}
      <p className="pool__note">Posts stay in for {POOL_DAYS} days. Usernames and posts here are public.</p>
    </div>
  );
}

export function WhoIsInSkeleton() {
  return (
    <div className="pool__body" aria-busy="true">
      <p className="visually-hidden" role="status">
        Loading who&apos;s in the draw
      </p>
      <span className="skeleton-line skeleton-line--short" aria-hidden="true" />
      <span className="skeleton-line" aria-hidden="true" />
    </div>
  );
}
