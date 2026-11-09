import "server-only";
import type { Db } from "mongodb";
import { entriesCollection } from "./collections";
import { isDuplicateKeyError } from "./http";
import { postUrlVariants, type InstagramPost } from "./instagram";

export type CreateEntryResult = { ok: true } | { ok: false; reason: "duplicate" };

/**
 * True if this post is already entered under any post type (/p/, /reel/ or
 * /tv/ normalise to different links). Checked before asking Instagram who
 * owns the post, so duplicates don't cost an Instagram request.
 */
export async function isAlreadyEntered(db: Db, post: InstagramPost): Promise<boolean> {
  const existing = await entriesCollection(db).findOne(
    { url: { $in: postUrlVariants(post.shortcode) } },
    { projection: { _id: 1 } },
  );
  return existing !== null;
}

/**
 * Stores an entry exactly in the shared shape: { url, username, createdAt, drawDate: null }.
 * The unique index on `url` rejects a duplicate that races past isAlreadyEntered.
 */
export async function createEntry(
  db: Db,
  post: InstagramPost,
  username: string,
  now: Date,
): Promise<CreateEntryResult> {
  try {
    await entriesCollection(db).insertOne({ url: post.url, username, createdAt: now, drawDate: null });
    return { ok: true };
  } catch (error) {
    if (isDuplicateKeyError(error)) return { ok: false, reason: "duplicate" };
    throw error;
  }
}
