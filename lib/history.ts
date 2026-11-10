import "server-only";
import type { Db, Document } from "mongodb";
import { drawsCollection, entriesCollection } from "./collections";
import { HISTORY_LIMIT, POOL_DAYS, POOL_LIST_LIMIT } from "./config";
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
  /**
   * The draw still to come, tonight at 00:00. It has no date on purpose: the
   * bot dates a draw by the London day it runs, which is the day after the
   * entries came in, and the page shouldn't depend on that.
   */
  next: { poolSize: number };
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

  return { today, next: { poolSize: await countPool(db, now) }, draws };
}

/** The most recent valid result the bot has written (dated today or earlier). */
export async function loadLatestDraw(db: Db, now: Date): Promise<DrawSummary | null> {
  const docs = await drawsCollection(db)
    .find({ date: { $lte: londonDateKey(now) } }, { projection: { _id: 0 } })
    .sort({ date: -1 })
    .limit(5)
    .toArray();
  for (const doc of docs) {
    const summary = toSummary(doc);
    if (summary) return summary;
  }
  return null;
}

/** What the result card needs from a draw. Only a draw with a winner has a card. */
export interface CardDraw {
  date: DateKey;
  drawNumber: number;
  entryCount: number;
  winnerUsername: string;
}

/**
 * The draw for one date, checked like the history, or null when there is no
 * winner to show (no draw yet, an empty pool, or data the bot wrote badly).
 */
export async function loadCardDraw(db: Db, date: DateKey): Promise<CardDraw | null> {
  const doc = await drawsCollection(db).findOne({ date }, { projection: { _id: 0 } });
  if (!doc) return null;
  const summary = toSummary(doc);
  if (!summary?.winnerUsername || summary.entryCount === null || summary.entryCount < 1) return null;
  const drawNumber: unknown = doc.drawNumber;
  if (typeof drawNumber !== "number" || !Number.isSafeInteger(drawNumber) || drawNumber < 1) return null;
  return {
    date: summary.date,
    drawNumber,
    entryCount: summary.entryCount,
    winnerUsername: summary.winnerUsername,
  };
}

/** What the story image needs. `winnerUsername` is null on a night with no entries. */
export interface StoryDraw {
  date: DateKey;
  drawNumber: number;
  entryCount: number;
  winnerUsername: string | null;
}

/**
 * The draw for one date, for the story image. A night with a winner matches
 * the card. A night the bot recorded as empty (no username, zero entries)
 * still returns a draw, so a story can be posted. Anything else is null:
 * no document, a winner that failed the checks, or a count that isn't a
 * whole number.
 */
export async function loadStoryDraw(db: Db, date: DateKey): Promise<StoryDraw | null> {
  const doc = await drawsCollection(db).findOne({ date }, { projection: { _id: 0 } });
  if (!doc) return null;
  const summary = toSummary(doc);
  if (!summary || summary.entryCount === null) return null;
  const drawNumber: unknown = doc.drawNumber;
  if (typeof drawNumber !== "number" || !Number.isSafeInteger(drawNumber) || drawNumber < 1) return null;

  if (summary.winnerUsername && summary.entryCount >= 1) {
    return {
      date: summary.date,
      drawNumber,
      entryCount: summary.entryCount,
      winnerUsername: summary.winnerUsername,
    };
  }

  const rawWinner = doc.winnerUsername;
  const noWinner = rawWinner == null || (typeof rawWinner === "string" && rawWinner.trim() === "");
  if (noWinner && summary.entryCount === 0) {
    return { date: summary.date, drawNumber, entryCount: 0, winnerUsername: null };
  }
  return null;
}

/** Entries currently in the pool: not picked yet and entered in the last 7 days. */
function poolFilter(now: Date) {
  const since = new Date(now.getTime() - POOL_DAYS * 24 * 60 * 60 * 1000);
  return { drawDate: null, createdAt: { $gte: since } };
}

export async function countPool(db: Db, now: Date): Promise<number> {
  return entriesCollection(db).countDocuments(poolFilter(now));
}

export interface PoolEntry {
  username: string;
  url: string;
}

export interface PoolData {
  /** Everyone in the pool. */
  total: number;
  /** The newest entries, up to the limit. */
  entries: PoolEntry[];
}

/** Who's in the draw: the current pool, newest first. */
export async function loadPool(db: Db, now: Date, limit: number = POOL_LIST_LIMIT): Promise<PoolData> {
  const entries = entriesCollection(db);
  const [total, docs] = await Promise.all([
    entries.countDocuments(poolFilter(now)),
    entries
      .find(poolFilter(now), { projection: { _id: 0, url: 1, username: 1 } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray(),
  ]);
  return {
    total,
    entries: docs.flatMap((doc) => {
      const user = parseInstagramUsername(doc.username);
      const post = parseInstagramPostUrl(doc.url);
      return user.ok && post.ok ? [{ username: user.username, url: post.post.url }] : [];
    }),
  };
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
