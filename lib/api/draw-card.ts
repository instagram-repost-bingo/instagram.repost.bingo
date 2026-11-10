import "server-only";
import type { Db } from "mongodb";
import { CARD_RATE_LIMIT } from "../config";
import { formatCardDate } from "../format";
import { loadCardDraw, loadStoryDraw, type CardDraw, type StoryDraw } from "../history";
import { clientIp, jsonResponse } from "../http";
import { isDateKey, londonDateKey } from "../london-time";
import { consumeRateLimit, hashSubject, rateLimitSubject } from "../rate-limit";
import type { ResultCardInput, StoryCardInput } from "../result-card";

export interface DrawCardDeps {
  getDb: () => Db | Promise<Db>;
  /** Key for hashing IP addresses in the rate limiter. */
  rateLimitSecret: string | undefined;
  /** Draws the card (see lib/result-card.ts) and returns it as a JPEG. */
  renderJpeg: (input: ResultCardInput) => Promise<Uint8Array>;
  now?: () => Date;
}

export interface DrawStoryDeps {
  getDb: () => Db | Promise<Db>;
  /** Key for hashing IP addresses in the rate limiter. Same bucket as the card. */
  rateLimitSecret: string | undefined;
  /** Draws the story (see lib/result-card.ts) and returns it as a JPEG. */
  renderJpeg: (input: StoryCardInput) => Promise<Uint8Array>;
  now?: () => Date;
}

export type DrawCardErrorCode = "not_found" | "rate_limited" | "unavailable";

/**
 * A draw never changes once the bot has written it, so the CDN keeps an image
 * for a day and browsers for an hour. A new deploy starts with an empty cache.
 * The card and the story both send this header and share one rate-limit bucket.
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

  return serveJpeg(request, deps, db, now, draw.date, `repost-bingo-${draw.date}.jpg`, "card", () =>
    deps.renderJpeg({
      drawNumber: draw.drawNumber,
      dateLabel: formatCardDate(draw.date),
      winnerUsername: draw.winnerUsername,
      entryCount: draw.entryCount,
    }),
  );
}

/**
 * GET /api/draws/{date}/story.jpg: a 1080×1920 pitch for that night's draw.
 * A night with no entries still gets an image. Same cache and per-IP limit
 * as the card (one shared bucket).
 */
export async function handleDrawStory(request: Request, date: string, deps: DrawStoryDeps): Promise<Response> {
  const now = deps.now?.() ?? new Date();
  if (!isDateKey(date) || date > londonDateKey(now)) return notFound("There's no story for that date.");

  let draw: StoryDraw | null;
  let db: Db;
  try {
    db = await deps.getDb();
    draw = await loadStoryDraw(db, date);
  } catch (error) {
    console.error("[story] database unavailable", error);
    return unavailable();
  }
  if (!draw) return notFound("There's no story for that date.");

  return serveJpeg(request, deps, db, now, draw.date, `repost-bingo-${draw.date}-story.jpg`, "story", () =>
    deps.renderJpeg({
      drawNumber: draw.drawNumber,
      dateLabel: formatCardDate(draw.date),
      winnerUsername: draw.winnerUsername,
      entryCount: draw.entryCount,
    }),
  );
}

/** Rate-limits, draws and returns a JPEG. The card and the story share `card:<ip>`. */
async function serveJpeg(
  request: Request,
  deps: { rateLimitSecret: string | undefined },
  db: Db,
  now: Date,
  date: string,
  filename: string,
  label: "card" | "story",
  render: () => Promise<Uint8Array>,
): Promise<Response> {
  try {
    const bucket = `card:${hashSubject(rateLimitSubject(clientIp(request.headers)), deps.rateLimitSecret)}`;
    const limit = await consumeRateLimit(db, bucket, CARD_RATE_LIMIT, now);
    if (!limit.allowed) {
      const noun = label === "card" ? "cards" : "stories";
      return errorResponse(429, "rate_limited", `Too many ${noun}. Please wait a few minutes and try again.`, {
        "Retry-After": String(limit.retryAfterSeconds),
      });
    }
  } catch (error) {
    console.error(`[${label}] database unavailable`, error);
    return unavailable();
  }

  let jpeg: Uint8Array;
  try {
    jpeg = await render();
  } catch (error) {
    console.error(`[${label}] could not draw the ${label} for ${date}`, error);
    return unavailable();
  }

  return new Response(new Uint8Array(jpeg), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(jpeg.byteLength),
      "Content-Disposition": `inline; filename="${filename}"`,
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

function notFound(message = "There's no winner card for that date."): Response {
  return errorResponse(404, "not_found", message);
}

function unavailable(): Response {
  return errorResponse(503, "unavailable", "Something went wrong on our side. Please try again in a minute.");
}
