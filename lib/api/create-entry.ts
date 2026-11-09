import "server-only";
import type { Db } from "mongodb";
import { ensureIndexesOnce } from "../collections";
import { SUBMIT_RATE_LIMIT } from "../config";
import { createEntry } from "../entries";
import { ENTRY_ACCEPTED_MESSAGE } from "../format";
import { clientIp, jsonResponse } from "../http";
import {
  describeLinkFailure,
  describeUsernameFailure,
  parseInstagramPostUrl,
  parseInstagramUsername,
} from "../instagram";
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
  now?: () => Date;
}

export type CreateEntryErrorCode =
  | "unsupported_media_type"
  | "payload_too_large"
  | "invalid_json"
  | "rate_limited"
  | "invalid_url"
  | "invalid_username"
  | "bot_check_failed"
  | "duplicate"
  | "unavailable";

type Field = "url" | "username";

const MAX_BODY_BYTES = 8 * 1024;

/**
 * POST /api/entries with JSON { url, username, turnstileToken }.
 * Order: cheap request checks, per-IP rate limit (counts every attempt),
 * validation, Turnstile, then the insert.
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
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      });
    }
  } catch (error) {
    console.error("[entries] database unavailable", error);
    return unavailable();
  }

  const link = parseInstagramPostUrl(body.url);
  if (!link.ok) {
    return errorResponse(400, "invalid_url", describeLinkFailure(link.reason), { field: "url" });
  }
  const user = parseInstagramUsername(body.username);
  if (!user.ok) {
    return errorResponse(400, "invalid_username", describeUsernameFailure(user.reason), { field: "username" });
  }

  if (deps.verifyTurnstile) {
    const check = await deps.verifyTurnstile(body.turnstileToken, ip);
    if (!check.success) {
      return errorResponse(403, "bot_check_failed", "We couldn't confirm you're a person. Please try again.");
    }
  }

  try {
    const result = await createEntry(db, link.post, user.username, now);
    if (!result.ok) {
      return errorResponse(409, "duplicate", "That post has already been entered. Each post can only go in once.", {
        field: "url",
      });
    }
    return jsonResponse({ ok: true, message: ENTRY_ACCEPTED_MESSAGE, entry: { url: link.post.url, username: user.username } }, 201);
  } catch (error) {
    console.error("[entries] insert failed", error);
    return unavailable();
  }
}

function errorResponse(
  status: number,
  code: CreateEntryErrorCode,
  message: string,
  extra: { field?: Field; headers?: Record<string, string> } = {},
): Response {
  return jsonResponse({ ok: false, code, message, field: extra.field }, status, extra.headers);
}

function tooLarge(): Response {
  return errorResponse(413, "payload_too_large", "That's too much text. Paste just the post link and your username.");
}

function unavailable(): Response {
  return errorResponse(503, "unavailable", "Something went wrong on our side. Please try again in a minute.");
}
