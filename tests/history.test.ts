import type { Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { countPool, loadHistory, toSummary } from "@/lib/history";
import { startTestMongo } from "./support/mongo";

let mongo: Awaited<ReturnType<typeof startTestMongo>>;
beforeAll(async () => {
  mongo = await startTestMongo();
});
afterAll(async () => {
  await mongo?.stop();
});

/** A draw exactly as the bot writes it. */
function botDraw(date: string, overrides: Record<string, unknown> = {}) {
  return {
    date,
    entryCount: 12,
    winnerUrl: `https://www.instagram.com/p/Win${date.replaceAll("-", "")}`,
    winnerUsername: "lucky.one",
    resultPostUrl: `https://www.instagram.com/p/Res${date.replaceAll("-", "")}`,
    createdAt: new Date(`${date}T12:00:30Z`),
    ...overrides,
  };
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
  it("shows 'Draw at 12:00' for today until the bot writes the result", async () => {
    const db = mongo.freshDb();
    await seed(db, [botDraw("2026-11-07"), botDraw("2026-11-08")]);

    const morning = await loadHistory(db, new Date("2026-11-09T10:00:00Z"));
    expect(morning.today).toBe("2026-11-09");
    expect(morning.pending).toEqual({ date: "2026-11-09", poolSize: 0 });
    expect(morning.draws.map((d) => d.date)).toEqual(["2026-11-08", "2026-11-07"]);

    // Still pending after 12:00 if the bot hasn't written today's result yet.
    expect((await loadHistory(db, new Date("2026-11-09T12:30:00Z"))).pending).not.toBeNull();

    await seed(db, [botDraw("2026-11-09")]);
    const afternoon = await loadHistory(db, new Date("2026-11-09T12:31:00Z"));
    expect(afternoon.pending).toBeNull();
    expect(afternoon.draws[0]).toEqual({
      date: "2026-11-09",
      entryCount: 12,
      winnerUsername: "lucky.one",
      winnerUrl: "https://www.instagram.com/p/Win20261109",
      resultPostUrl: "https://www.instagram.com/p/Res20261109",
    });
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

  it("shows a draw before its result post is published", async () => {
    const db = mongo.freshDb();
    await seed(db, [botDraw("2026-11-09", { resultPostUrl: null })]);
    const history = await loadHistory(db, new Date("2026-11-09T13:00:00Z"));
    expect(history.draws[0]).toMatchObject({ winnerUsername: "lucky.one", resultPostUrl: null });
  });
});

describe("pool size for today's pending draw", () => {
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
    expect((await loadHistory(db, now)).pending).toEqual({ date: "2026-11-09", poolSize: 2 });
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
