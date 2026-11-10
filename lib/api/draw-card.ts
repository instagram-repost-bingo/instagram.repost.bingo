import "server-only";
import type { Db } from "mongodb";
import { CARD_RATE_LIMIT } from "../config";
import { formatCardDate } from "../format";
import { loadCardDraw, type CardDraw } from "../history";
import { clientIp, jsonResponse } from "../http";
import { isDateKey, londonDateKey } from "../london-time";
import { consumeRateLimit, hashSubject, rateLimitSubject } from "../rate-limit";
import type { ResultCardInput } from "../result-card";

export interface DrawCardDeps {
  getDb: () => Db | Promise<Db>;
  /** Key for hashing IP addresses in the rate limiter. */
  rateLimitSecret: string | undefined;
  /** Draws the card (see lib/result-card.ts) and returns it as a JPEG. */
  renderJpeg: (input: ResultCardInput) => Promise<Uint8Array>;
  now?: () => Date;
}

export type DrawCardErrorCode = "not_found" | "rate_limited" | "unavailable";

/**
 * A draw never changes once the bot has written it, so the CDN keeps a card
 * for a day and browsers for an hour. A new deploy starts with an empty cache.
 */
export const CARD_CACHE_CONTROL = "public, max-age=3600, s-maxage=86400";

/**
 * GET /api/draws/{date}/card.jpg: the result card for the draw on that London
 * date, drawn on request as a 1080×1350 JPEG. A posting job can pass the URL
 * straight to Instagram as `image_url`.
 *
 * Order: the date is checked before the database is touched, a date without a
 * winner is a 404, and only a card that is actually drawn counts towards the
 * per-IP limit. Nothing but a card is cached.
 */
export async function handleDrawCard(request: Request, date: string, deps: DrawCardDeps): Promise<Response> {
  const now = deps.now?.() ?? new Date();
  if (!isDateKey(date) || date > londonDateKey(now)) return notFound();

  let draw: CardDraw | null;
  let db: Db;
  try {
    db = await deps.getDb();
    draw = await loadCardDraw(db, date);
  } catch (error) {
    console.error("[card] database unavailable", error);
    return unavailable();
  }
  if (!draw) return notFound();

  try {
    const bucket = `card:${hashSubject(rateLimitSubject(clientIp(request.headers)), deps.rateLimitSecret)}`;
    const limit = await consumeRateLimit(db, bucket, CARD_RATE_LIMIT, now);
    if (!limit.allowed) {
      return errorResponse(429, "rate_limited", "Too many cards. Please wait a few minutes and try again.", {
        "Retry-After": String(limit.retryAfterSeconds),
      });
    }
  } catch (error) {
    console.error("[card] database unavailable", error);
    return unavailable();
  }

  let jpeg: Uint8Array;
  try {
    jpeg = await deps.renderJpeg({
      drawNumber: draw.drawNumber,
      dateLabel: formatCardDate(draw.date),
      winnerUsername: draw.winnerUsername,
      entryCount: draw.entryCount,
    });
  } catch (error) {
    console.error(`[card] could not draw the card for ${draw.date}`, error);
    return unavailable();
  }

  return new Response(new Uint8Array(jpeg), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(jpeg.byteLength),
      "Content-Disposition": `inline; filename="repost-bingo-${draw.date}.jpg"`,
      "Cache-Control": CARD_CACHE_CONTROL,
    },
  });
}

function errorResponse(
  status: number,
  code: DrawCardErrorCode,
  message: string,
  headers?: Record<string, string>,
): Response {
  return jsonResponse({ ok: false, code, message }, status, headers);
}

function notFound(): Response {
  return errorResponse(404, "not_found", "There's no winner card for that date.");
}

function unavailable(): Response {
  return errorResponse(503, "unavailable", "Something went wrong on our side. Please try again in a minute.");
}
