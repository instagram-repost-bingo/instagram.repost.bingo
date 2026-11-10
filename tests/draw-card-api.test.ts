import type { Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CARD_CACHE_CONTROL, handleDrawCard, type DrawCardDeps } from "@/lib/api/draw-card";
import { CARD_RATE_LIMIT } from "@/lib/config";
import type { ResultCardInput } from "@/lib/result-card";
import { startTestMongo } from "./support/mongo";

let mongo: Awaited<ReturnType<typeof startTestMongo>>;
beforeAll(async () => {
  mongo = await startTestMongo();
});
afterAll(async () => {
  await mongo?.stop();
});

// 10 Nov 2026, 09:00 in London.
const NOW = new Date("2026-11-10T09:00:00Z");
const FAKE_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

function deps(db: Db, overrides: Partial<DrawCardDeps> = {}): DrawCardDeps {
  return {
    getDb: () => db,
    rateLimitSecret: "test-secret",
    renderJpeg: vi.fn(async () => FAKE_JPEG),
    now: () => NOW,
    ...overrides,
  };
}

function cardRequest(date: string, ip = "203.0.113.7"): Request {
  return new Request(`http://localhost/api/draws/${date}/card.jpg`, { headers: { "x-real-ip": ip } });
}

/** A draw as the bot writes it. */
function draw(overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-11-10",
    drawNumber: 12,
    entryCount: 24,
    winnerUrl: "https://www.instagram.com/p/DfiOsp6t354",
    winnerUsername: "lucky.duck",
    seed: "ab".repeat(32),
    resultPostId: null,
    resultPostUrl: null,
    status: "drawn",
    createdAt: new Date("2026-11-10T00:02:00Z"),
    ...overrides,
  };
}

describe("GET /api/draws/{date}/card.jpg", () => {
  it("draws the card for a recorded winner and lets the CDN cache it", async () => {
    const db = mongo.freshDb();
    await db.collection("draws").insertOne(draw());
    const renderJpeg = vi.fn(async (input: ResultCardInput) => {
      void input;
      return FAKE_JPEG;
    });

    const response = await handleDrawCard(cardRequest("2026-11-10"), "2026-11-10", deps(db, { renderJpeg }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe(CARD_CACHE_CONTROL);
    expect(response.headers.get("content-disposition")).toBe('inline; filename="repost-bingo-2026-11-10.jpg"');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(FAKE_JPEG);
    expect(renderJpeg).toHaveBeenCalledWith({
      drawNumber: 12,
      dateLabel: "10 Nov 2026",
      winnerUsername: "lucky.duck",
      entryCount: 24,
    });
  });

  it("works for a past draw too", async () => {
    const db = mongo.freshDb();
    await db.collection("draws").insertOne(draw({ date: "2026-10-31", drawNumber: 3 }));
    const response = await handleDrawCard(cardRequest("2026-10-31"), "2026-10-31", deps(db));
    expect(response.status).toBe(200);
  });

  it.each([
    ["a malformed date", "10-11-2026"],
    ["an impossible date", "2026-02-30"],
    ["a date after today in London", "2026-11-11"],
    ["something that is not a date", "latest"],
  ])("answers 404 for %s without touching the database", async (_label, date) => {
    const getDb = vi.fn(() => mongo.freshDb());
    const response = await handleDrawCard(cardRequest(date), date, { ...deps(mongo.freshDb()), getDb });
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ ok: false, code: "not_found" });
    expect(getDb).not.toHaveBeenCalled();
  });

  it.each([
    ["no draw for that date", null],
    ["an empty pool", draw({ status: "skipped_empty", entryCount: 0, winnerUrl: null, winnerUsername: null, seed: null })],
    ["a username that isn't valid", draw({ winnerUsername: "<script>" })],
    ["a missing draw number", draw({ drawNumber: undefined })],
    ["a draw number that isn't a whole number", draw({ drawNumber: 1.5 })],
    ["a missing entry count", draw({ entryCount: "24" })],
  ])("answers 404 for %s and draws nothing", async (_label, doc) => {
    const db = mongo.freshDb();
    if (doc) await db.collection("draws").insertOne(doc);
    const renderJpeg = vi.fn(async () => FAKE_JPEG);
    const response = await handleDrawCard(cardRequest("2026-11-10"), "2026-11-10", deps(db, { renderJpeg }));
    expect(response.status).toBe(404);
    expect(renderJpeg).not.toHaveBeenCalled();
  });

  it("limits how many cards one address can have drawn", async () => {
    const db = mongo.freshDb();
    await db.collection("draws").insertOne(draw());
    for (let i = 0; i < CARD_RATE_LIMIT.limit; i++) {
      const ok = await handleDrawCard(cardRequest("2026-11-10"), "2026-11-10", deps(db));
      expect(ok.status).toBe(200);
    }
    const limited = await handleDrawCard(cardRequest("2026-11-10"), "2026-11-10", deps(db));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(limited.headers.get("cache-control")).toBe("no-store");

    const otherAddress = await handleDrawCard(cardRequest("2026-11-10", "198.51.100.4"), "2026-11-10", deps(db));
    expect(otherAddress.status).toBe(200);
  });

  it("answers 503 when the database is down", async () => {
    const getDb = () => {
      throw new Error("connection refused");
    };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await handleDrawCard(cardRequest("2026-11-10"), "2026-11-10", { ...deps(mongo.freshDb()), getDb });
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    error.mockRestore();
  });

  it("answers 503, not a broken image, when drawing fails", async () => {
    const db = mongo.freshDb();
    await db.collection("draws").insertOne(draw());
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const renderJpeg = vi.fn(async (): Promise<Uint8Array> => {
      throw new Error("font missing");
    });
    const response = await handleDrawCard(cardRequest("2026-11-10"), "2026-11-10", deps(db, { renderJpeg }));
    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("application/json");
    error.mockRestore();
  });
});
