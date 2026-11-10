import type { Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { countPool, loadHistory, loadLatestDraw, loadPool, toSummary } from "@/lib/history";
import { startTestMongo } from "./support/mongo";

let mongo: Awaited<ReturnType<typeof startTestMongo>>;
beforeAll(async () => {
  mongo = await startTestMongo();
});
afterAll(async () => {
  await mongo?.stop();
});

/**
 * A draw exactly as the bot writes it (src/run.ts in repost-bingo-bot): dated
 * by the London day it ran, just after midnight, with the bot's own extra fields.
 */
function botDraw(date: string, overrides: Record<string, unknown> = {}) {
  return {
    date,
    drawNumber: Number(date.slice(8)),
    entryCount: 12,
    winnerUrl: `https://www.instagram.com/p/Win${date.replaceAll("-", "")}`,
    winnerUsername: "lucky.one",
    seed: "ab".repeat(32),
    resultPostId: "17900000000000000",
    resultPostUrl: `https://www.instagram.com/p/Res${date.replaceAll("-", "")}/`,
    status: "published",
    createdAt: new Date(`${date}T00:03:10Z`),
    imageUrl: "https://files.catbox.moe/card.jpg",
    containerId: "17890000000000000",
    winnerTagged: true,
    notifiedAt: new Date(`${date}T00:03:40Z`),
    error: null,
    ...overrides,
  };
}

/** A night with nobody in the pool, as the bot records it. */
function emptyDraw(date: string) {
  return botDraw(date, {
    entryCount: 0,
    winnerUrl: null,
    winnerUsername: null,
    seed: null,
    resultPostId: null,
    resultPostUrl: null,
    status: "skipped_empty",
    imageUrl: null,
    containerId: null,
    winnerTagged: null,
    notifiedAt: null,
  });
}

function entry(createdAt: string, drawDate: string | null = null) {
  return {
    url: `https://www.instagram.com/p/E${createdAt.replace(/\D/g, "")}${Math.random().toString(36).slice(2, 6)}`,
    username: "someone",
    createdAt: new Date(createdAt),
    drawDate,
  };
}

async function seed(db: Db, draws: object[], entries: object[] = []) {
  if (draws.length) await db.collection("draws").insertMany(draws.map((d) => ({ ...d })));
  if (entries.length) await db.collection("entries").insertMany(entries.map((e) => ({ ...e })));
}

describe("draw history", () => {
  it("always has a next draw, before and after tonight's result arrives", async () => {
    const db = mongo.freshDb();
    await seed(db, [botDraw("2026-11-07"), botDraw("2026-11-08")]);

    // 00:01 on the 9th: midnight has passed and the bot hasn't written the result yet.
    const justAfterMidnight = await loadHistory(db, new Date("2026-11-09T00:01:00Z"));
    expect(justAfterMidnight.today).toBe("2026-11-09");
    expect(justAfterMidnight.next).toEqual({ poolSize: 0 });
    expect(justAfterMidnight.draws.map((d) => d.date)).toEqual(["2026-11-08", "2026-11-07"]);

    // The bot dates the midnight draw by the day it ran: the 9th.
    await seed(db, [botDraw("2026-11-09")]);
    const morning = await loadHistory(db, new Date("2026-11-09T10:00:00Z"));
    expect(morning.next).toEqual({ poolSize: 0 });
    expect(morning.draws.map((d) => d.date)).toEqual(["2026-11-09", "2026-11-08", "2026-11-07"]);
    expect(morning.draws[0]).toEqual({
      date: "2026-11-09",
      entryCount: 12,
      winnerUsername: "lucky.one",
      winnerUrl: "https://www.instagram.com/p/Win20261109",
      resultPostUrl: "https://www.instagram.com/p/Res20261109",
    });
  });

  it("reads a night with no entries as a draw without a winner", async () => {
    const db = mongo.freshDb();
    await seed(db, [emptyDraw("2026-11-09")]);
    const history = await loadHistory(db, new Date("2026-11-09T10:00:00Z"));
    expect(history.draws).toEqual([
      { date: "2026-11-09", entryCount: 0, winnerUsername: null, winnerUrl: null, resultPostUrl: null },
    ]);
  });

  it("uses the London date for today, in summer too", async () => {
    const db = mongo.freshDb();
    // 23:30 UTC on 1 July is already 2 July in London (BST).
    const history = await loadHistory(db, new Date("2026-07-01T23:30:00Z"));
    expect(history.today).toBe("2026-07-02");
  });

  it("lists draws newest first and respects the limit", async () => {
    const db = mongo.freshDb();
    await seed(db, ["2026-11-03", "2026-11-05", "2026-11-04", "2026-11-06"].map((date) => botDraw(date)));
    const history = await loadHistory(db, new Date("2026-11-09T10:00:00Z"), 3);
    expect(history.draws.map((d) => d.date)).toEqual(["2026-11-06", "2026-11-05", "2026-11-04"]);
  });

  it("ignores draws dated in the future", async () => {
    const db = mongo.freshDb();
    await seed(db, [botDraw("2026-11-08"), botDraw("2026-11-12")]);
    const history = await loadHistory(db, new Date("2026-11-09T10:00:00Z"));
    expect(history.draws.map((d) => d.date)).toEqual(["2026-11-08"]);
  });

  it("shows a winner before the result post is published, or if posting failed", async () => {
    const db = mongo.freshDb();
    await seed(db, [
      botDraw("2026-11-09", { resultPostId: null, resultPostUrl: null, status: "failed", error: "Image upload failed (503)" }),
    ]);
    const history = await loadHistory(db, new Date("2026-11-09T13:00:00Z"));
    expect(history.draws[0]).toMatchObject({ winnerUsername: "lucky.one", resultPostUrl: null });
  });
});

describe("pool size for the next draw", () => {
  it("counts entries not yet picked from the last 7 days", async () => {
    const db = mongo.freshDb();
    const now = new Date("2026-11-09T10:00:00Z");
    await seed(
      db,
      [],
      [
        entry("2026-11-09T09:00:00Z"),
        entry("2026-11-03T10:00:01Z"), // just inside 7 days
        entry("2026-11-02T09:59:59Z"), // older than 7 days
        entry("2026-11-08T09:00:00Z", "2026-11-08"), // already picked by the bot
      ],
    );
    expect(await countPool(db, now)).toBe(2);
    expect((await loadHistory(db, now)).next).toEqual({ poolSize: 2 });
  });
});

describe("reading what the bot wrote, defensively", () => {
  it("drops documents without a valid date", () => {
    expect(toSummary({ ...botDraw("2026-11-09"), date: "9 Nov" })).toBeNull();
    expect(toSummary({ ...botDraw("2026-11-09"), date: new Date("2026-11-09") })).toBeNull();
  });

  it("never passes through a link that isn't an Instagram post", () => {
    const summary = toSummary(
      botDraw("2026-11-09", {
        winnerUrl: "javascript:alert(1)",
        resultPostUrl: "https://evil.example/p/ABC",
        winnerUsername: "<img src=x>",
        entryCount: -3,
      }),
    );
    expect(summary).toEqual({
      date: "2026-11-09",
      entryCount: null,
      winnerUsername: null,
      winnerUrl: null,
      resultPostUrl: null,
    });
  });

  it("normalises the links and usernames it shows", () => {
    const summary = toSummary(
      botDraw("2026-11-09", {
        winnerUrl: "https://instagram.com/reel/C9-kL2mNoPq/?igsh=1",
        winnerUsername: "@Lucky.One",
      }),
    );
    expect(summary).toMatchObject({
      winnerUrl: "https://www.instagram.com/reel/C9-kL2mNoPq",
      winnerUsername: "lucky.one",
    });
  });
});

describe("who's in (the current pool)", () => {
  const now = new Date("2026-11-09T10:00:00Z");
  const at = (iso: string, username: string, shortcode: string, drawDate: string | null = null) => ({
    url: `https://www.instagram.com/p/${shortcode}`,
    username,
    createdAt: new Date(iso),
    drawDate,
  });

  it("lists everyone in the pool, newest first, with a total", async () => {
    const db = mongo.freshDb();
    await seed(db, [], [
      at("2026-11-08T09:00:00Z", "older.one", "OlderPost01"),
      at("2026-11-09T09:30:00Z", "newest.one", "NewestPost1"),
      at("2026-11-09T08:00:00Z", "middle_one", "MiddlePost1"),
      at("2026-11-01T09:00:00Z", "expired.one", "ExpiredPst1"), // more than 7 days ago
      at("2026-11-08T08:00:00Z", "past.winner", "WinnerPost1", "2026-11-08"), // already picked
    ]);
    const pool = await loadPool(db, now);
    expect(pool.total).toBe(3);
    expect(pool.entries).toEqual([
      { username: "newest.one", url: "https://www.instagram.com/p/NewestPost1" },
      { username: "middle_one", url: "https://www.instagram.com/p/MiddlePost1" },
      { username: "older.one", url: "https://www.instagram.com/p/OlderPost01" },
    ]);
  });

  it("caps the list but keeps the full total", async () => {
    const db = mongo.freshDb();
    await seed(db, [], Array.from({ length: 5 }, (_, i) => at(`2026-11-09T0${i}:00:00Z`, `user${i}`, `PostNumber${i}`)));
    const pool = await loadPool(db, now, 2);
    expect(pool.total).toBe(5);
    expect(pool.entries.map((e) => e.username)).toEqual(["user4", "user3"]);
  });

  it("skips entries with an invalid username or link", async () => {
    const db = mongo.freshDb();
    await seed(db, [], [
      at("2026-11-09T09:00:00Z", "<script>", "BadUserPost"),
      { ...at("2026-11-09T08:00:00Z", "fine.user", "x"), url: "javascript:alert(1)" },
      at("2026-11-09T07:00:00Z", "fine.user", "GoodPost001"),
    ]);
    expect((await loadPool(db, now)).entries).toEqual([
      { username: "fine.user", url: "https://www.instagram.com/p/GoodPost001" },
    ]);
  });

  it("is empty when nobody has entered", async () => {
    expect(await loadPool(mongo.freshDb(), now)).toEqual({ total: 0, entries: [] });
  });
});

describe("last night's winner", () => {
  it("is the most recent result dated today or earlier", async () => {
    const db = mongo.freshDb();
    await seed(db, [botDraw("2026-11-07"), botDraw("2026-11-08", { winnerUsername: "last.night" }), botDraw("2026-11-12")]);
    const latest = await loadLatestDraw(db, new Date("2026-11-09T10:00:00Z"));
    expect(latest).toMatchObject({ date: "2026-11-08", winnerUsername: "last.night" });
  });

  it("skips a badly formed newest document", async () => {
    const db = mongo.freshDb();
    await seed(db, [botDraw("2026-11-07", { winnerUsername: "good.one" }), { ...botDraw("2026-11-08"), date: "8 Nov" }]);
    expect((await loadLatestDraw(db, new Date("2026-11-09T10:00:00Z")))?.winnerUsername).toBe("good.one");
  });

  it("is null before the first draw", async () => {
    expect(await loadLatestDraw(mongo.freshDb(), new Date("2026-11-09T10:00:00Z"))).toBeNull();
  });
});
