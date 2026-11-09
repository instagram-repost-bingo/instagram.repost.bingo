import "server-only";
import type { Db } from "mongodb";
import { ensureIndexesOnce } from "../collections";
import { INSTAGRAM_HANDLE, SUBMIT_RATE_LIMIT } from "../config";
import { createEntry, isAlreadyEntered } from "../entries";
import { entryAcceptedMessage } from "../format";
import { clientIp, jsonResponse } from "../http";
import { describeLinkFailure, parseInstagramPostUrl } from "../instagram";
import type { OwnerLookup } from "../instagram-owner";
import { consumeRateLimit, hashSubject, rateLimitSubject } from "../rate-limit";
import type { TurnstileVerifier } from "../turnstile";

export interface CreateEntryDeps {
  getDb: () => Db | Promise<Db>;
  /** null when no Turnstile secret is configured. */
  verifyTurnstile: TurnstileVerifier | null;
  /** In production a missing Turnstile secret refuses entries instead of skipping the check. */
  requireTurnstile: boolean;
  /** Key for hashing IP addresses in the rate limiter. */
  rateLimitSecret: string | undefined;
  /** Reads the post's owner from Instagram (see lib/instagram-owner.ts). */
  lookupOwner: OwnerLookup;
  now?: () => Date;
}

export type CreateEntryErrorCode =
  | "unsupported_media_type"
  | "payload_too_large"
  | "invalid_json"
  | "rate_limited"
  | "invalid_url"
  | "bot_check_failed"
  | "duplicate"
  | "not_public"
  | "own_post"
  | "instagram_unavailable"
  | "unavailable";

const MAX_BODY_BYTES = 8 * 1024;

/**
 * POST /api/entries with JSON { url, turnstileToken }.
 *
 * The username isn't typed in: it is the post's owner, read from Instagram.
 * Order: cheap request checks, per-IP rate limit (counts every attempt), link
 * validation, Turnstile, duplicate check, the Instagram owner lookup, then the
 * insert. Bots and duplicates never cause a request to Instagram.
 */
export async function handleCreateEntry(request: Request, deps: CreateEntryDeps): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return errorResponse(415, "unsupported_media_type", "Please send your entry from the form on repost.bingo.");
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) return tooLarge();
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return tooLarge();

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return errorResponse(400, "invalid_json", "Something went wrong sending your entry. Please try again.");
  }
  const body = (typeof payload === "object" && payload !== null ? payload : {}) as Record<string, unknown>;

  if (!deps.verifyTurnstile && deps.requireTurnstile) {
    console.error("[entries] TURNSTILE_SECRET_KEY is not set: refusing entries until it is configured");
    return unavailable();
  }

  const now = deps.now?.() ?? new Date();
  const ip = clientIp(request.headers);

  let db: Db;
  try {
    db = await deps.getDb();
    await ensureIndexesOnce(db);
    const bucket = `submit:${hashSubject(rateLimitSubject(ip), deps.rateLimitSecret)}`;
    const limit = await consumeRateLimit(db, bucket, SUBMIT_RATE_LIMIT, now);
    if (!limit.allowed) {
      return errorResponse(429, "rate_limited", "That's a lot of tries. Please wait a few minutes and try again.", {
        "Retry-After": String(limit.retryAfterSeconds),
      });
    }
  } catch (error) {
    console.error("[entries] database unavailable", error);
    return unavailable();
  }

  const link = parseInstagramPostUrl(body.url);
  if (!link.ok) return errorResponse(400, "invalid_url", describeLinkFailure(link.reason));

  if (deps.verifyTurnstile) {
    const check = await deps.verifyTurnstile(body.turnstileToken, ip);
    if (!check.success) {
      return errorResponse(403, "bot_check_failed", "We couldn't confirm you're a person. Please try again.");
    }
  }

  try {
    if (await isAlreadyEntered(db, link.post)) return duplicate();
  } catch (error) {
    console.error("[entries] duplicate check failed", error);
    return unavailable();
  }

  const owner = await deps.lookupOwner(link.post);
  if (!owner.ok) {
    if (owner.reason === "not_public") {
      return errorResponse(
        422,
        "not_public",
        "We couldn't open that post on Instagram. Check the link is right and that your account is public.",
      );
    }
    console.warn(`[entries] Instagram didn't answer for ${link.post.url}`);
    return errorResponse(
      503,
      "instagram_unavailable",
      "We couldn't check your post with Instagram just now. Please try again in a few minutes.",
    );
  }
  if (owner.username === INSTAGRAM_HANDLE) {
    return errorResponse(422, "own_post", "That's one of our own posts. Paste a link to one of yours.");
  }

  try {
    const result = await createEntry(db, link.post, owner.username, now);
    if (!result.ok) return duplicate();
    return jsonResponse(
      {
        ok: true,
        message: entryAcceptedMessage(owner.username),
        entry: { url: link.post.url, username: owner.username },
      },
      201,
    );
  } catch (error) {
    console.error("[entries] insert failed", error);
    return unavailable();
  }
}

function errorResponse(
  status: number,
  code: CreateEntryErrorCode,
  message: string,
  headers?: Record<string, string>,
): Response {
  return jsonResponse({ ok: false, code, message }, status, headers);
}

function duplicate(): Response {
  return errorResponse(409, "duplicate", "That post has already been entered. Each post can only go in once.");
}

function tooLarge(): Response {
  return errorResponse(413, "payload_too_large", "That's too much text. Paste just the post link.");
}

function unavailable(): Response {
  return errorResponse(503, "unavailable", "Something went wrong on our side. Please try again in a minute.");
}
