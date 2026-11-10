import "server-only";
import type { Collection, Db, Document, IndexSpecification, ObjectId } from "mongodb";

// SHARED DATA CONTRACT with the bot repo (repost-bingo-bot). Don't change these
// shapes without updating the bot.
//
//   entries: { url (unique), username, createdAt, drawDate | null }   written here
//   draws:   { date "YYYY-MM-DD", drawNumber, entryCount, winnerUrl,
//              winnerUsername, resultPostUrl | null, createdAt }      read-only here

/** One submitted post. The website inserts it; the bot sets drawDate when it wins. */
export interface EntryDoc {
  _id?: ObjectId;
  /** Normalised post link (see lib/instagram.ts). Unique. */
  url: string;
  /** Instagram username, lowercase, without "@". */
  username: string;
  createdAt: Date;
  /** Always null from the website. */
  drawDate: string | null;
}

/** One daily result, written by the bot. Read defensively: see lib/history.ts. */
export interface DrawDoc {
  _id?: ObjectId;
  date: string;
  /** 1, 2, 3 and so on, counting nights with an empty pool. Printed on the result card. */
  drawNumber: number;
  entryCount: number;
  winnerUrl: string;
  winnerUsername: string;
  resultPostUrl: string | null;
  createdAt: Date;
}

/** Website-only: per-IP submit counter for one time window, deleted by a TTL index. */
export interface RateLimitDoc {
  _id: string;
  count: number;
  expiresAt: Date;
}

export const entriesCollection = (db: Db): Collection<EntryDoc> => db.collection<EntryDoc>("entries");

export const drawsCollection = (db: Db): Collection<DrawDoc> => db.collection<DrawDoc>("draws");

export const rateLimitsCollection = (db: Db): Collection<RateLimitDoc> =>
  db.collection<RateLimitDoc>("rate_limits");

/**
 * Indexes the website relies on. The website only creates indexes on what it
 * writes: the unique `entries.url` index (rejects duplicates) and the TTL index
 * on its own `rate_limits` collection. `draws` belongs to the bot.
 */
export async function ensureIndexes(db: Db): Promise<void> {
  await Promise.all([
    createIndexIfPossible(entriesCollection(db), { url: 1 }, { unique: true }),
    createIndexIfPossible(rateLimitsCollection(db), { expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]);
}

const indexesReady = new Map<string, Promise<void>>();

/** Makes sure the indexes exist before the first write on this server instance. */
export function ensureIndexesOnce(db: Db): Promise<void> {
  const key = db.databaseName;
  let pending = indexesReady.get(key);
  if (!pending) {
    pending = ensureIndexes(db).catch((error: unknown) => {
      indexesReady.delete(key);
      throw error;
    });
    indexesReady.set(key, pending);
  }
  return pending;
}

// 85 IndexOptionsConflict, 86 IndexKeySpecsConflict, 11000 existing duplicates.
const INDEX_CONFLICT_CODES = new Set([85, 86, 11000]);

/**
 * Default index names mean that if the bot creates the same index, this is a
 * no-op. If the bot defined it differently, log loudly instead of refusing every
 * entry: the website also checks for duplicates before inserting.
 */
async function createIndexIfPossible<T extends Document>(
  collection: Collection<T>,
  key: IndexSpecification,
  options: { unique?: boolean; expireAfterSeconds?: number },
): Promise<void> {
  try {
    await collection.createIndex(key, options);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "number" && INDEX_CONFLICT_CODES.has(code)) {
      console.error(
        `[db] could not create index ${JSON.stringify(key)} on ${collection.collectionName}; an existing index or data conflicts with it`,
        error,
      );
      return;
    }
    throw error;
  }
}
