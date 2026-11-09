import "server-only";
import type { Db } from "mongodb";
import { entriesCollection } from "./collections";
import { isDuplicateKeyError } from "./http";
import { postUrlVariants, type InstagramPost } from "./instagram";

export type CreateEntryResult = { ok: true } | { ok: false; reason: "duplicate" };

/**
 * Stores an entry exactly in the shared shape: { url, username, createdAt, drawDate: null }.
 *
 * Duplicates: the unique index on `url` rejects the same normalised link
 * atomically. The lookup first also catches the same post entered under another
 * post type (/p/ vs /reel/ vs /tv/), which normalises to a different link.
 */
export async function createEntry(
  db: Db,
  post: InstagramPost,
  username: string,
  now: Date,
): Promise<CreateEntryResult> {
  const entries = entriesCollection(db);

  const existing = await entries.findOne(
    { url: { $in: postUrlVariants(post.shortcode) } },
    { projection: { _id: 1 } },
  );
  if (existing) return { ok: false, reason: "duplicate" };

  try {
    await entries.insertOne({ url: post.url, username, createdAt: now, drawDate: null });
    return { ok: true };
  } catch (error) {
    if (isDuplicateKeyError(error)) return { ok: false, reason: "duplicate" };
    throw error;
  }
}
