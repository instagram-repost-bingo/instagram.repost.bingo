import "server-only";
import type { Db, Document } from "mongodb";
import { drawsCollection, entriesCollection } from "./collections";
import { HISTORY_LIMIT, POOL_DAYS } from "./config";
import { parseInstagramPostUrl, parseInstagramUsername } from "./instagram";
import { isDateKey, londonDateKey, type DateKey } from "./london-time";

/** A draw as the page shows it. Fields the bot wrote badly come through as null. */
export interface DrawSummary {
  date: DateKey;
  entryCount: number | null;
  winnerUsername: string | null;
  winnerUrl: string | null;
  resultPostUrl: string | null;
}

export interface HistoryData {
  today: DateKey;
  /** Set while today's result isn't in yet ("Draw at 12:00"). */
  pending: { date: DateKey; poolSize: number } | null;
  /** Results written by the bot, newest first. */
  draws: DrawSummary[];
}

/** Read-only view of `draws` (written by the bot) for the history list. */
export async function loadHistory(
  db: Db,
  now: Date,
  limit: number = HISTORY_LIMIT,
): Promise<HistoryData> {
  const today = londonDateKey(now);
  const docs = await drawsCollection(db)
    .find({ date: { $lte: today } }, { projection: { _id: 0 } })
    .sort({ date: -1 })
    .limit(limit)
    .toArray();

  const draws = docs.map(toSummary).filter((draw): draw is DrawSummary => draw !== null);
  const drawnToday = draws.some((draw) => draw.date === today);

  return {
    today,
    pending: drawnToday ? null : { date: today, poolSize: await countPool(db, now) },
    draws,
  };
}

/** Entries currently in the pool: not picked yet and entered in the last 7 days. */
export async function countPool(db: Db, now: Date): Promise<number> {
  const since = new Date(now.getTime() - POOL_DAYS * 24 * 60 * 60 * 1000);
  return entriesCollection(db).countDocuments({ drawDate: null, createdAt: { $gte: since } });
}

/**
 * The bot owns this data, so check it before rendering: only valid dates,
 * counts, usernames and Instagram post links get through. Anything else
 * (including a non-Instagram or javascript: link) becomes null.
 */
export function toSummary(doc: Document): DrawSummary | null {
  if (!isDateKey(doc.date)) return null;
  const winner = parseInstagramUsername(doc.winnerUsername);
  const winnerPost = parseInstagramPostUrl(doc.winnerUrl);
  const resultPost = parseInstagramPostUrl(doc.resultPostUrl);
  return {
    date: doc.date,
    entryCount:
      Number.isSafeInteger(doc.entryCount) && doc.entryCount >= 0 ? (doc.entryCount as number) : null,
    winnerUsername: winner.ok ? winner.username : null,
    winnerUrl: winnerPost.ok ? winnerPost.post.url : null,
    resultPostUrl: resultPost.ok ? resultPost.post.url : null,
  };
}
