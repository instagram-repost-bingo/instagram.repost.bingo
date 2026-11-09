import type { Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { handleCreateEntry, type CreateEntryDeps } from "@/lib/api/create-entry";
import { SUBMIT_RATE_LIMIT } from "@/lib/config";
import type { TurnstileVerifier } from "@/lib/turnstile";
import { startTestMongo } from "./support/mongo";

let mongo: Awaited<ReturnType<typeof startTestMongo>>;
beforeAll(async () => {
  mongo = await startTestMongo();
});
afterAll(async () => {
  await mongo?.stop();
});

const NOW = new Date("2026-11-09T10:00:00Z");
const passTurnstile = vi.fn<TurnstileVerifier>(async () => ({ success: true, errorCodes: [] }));

function deps(db: Db, overrides: Partial<CreateEntryDeps> = {}): CreateEntryDeps {
  return {
    getDb: () => db,
    verifyTurnstile: passTurnstile,
    requireTurnstile: true,
    rateLimitSecret: "test-secret",
    now: () => NOW,
    ...overrides,
  };
}

function submit(
  body: unknown,
  { ip = "203.0.113.7", contentType = "application/json" }: { ip?: string; contentType?: string } = {},
): Request {
  return new Request("http://localhost/api/entries", {
    method: "POST",
    headers: { "content-type": contentType, "x-real-ip": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const entry = (url: string, username = "@Some.Creator") => ({ url, username, turnstileToken: "token" });

describe("POST /api/entries", () => {
  it("stores exactly the shared shape: { url, username, createdAt, drawDate: null }", async () => {
    const db = mongo.freshDb();
    const response = await handleCreateEntry(
      submit(entry("https://WWW.Instagram.com/reel/C9-kL2mNoPq/?igsh=abc")),
      deps(db),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      ok: true,
      entry: { url: "https://www.instagram.com/reel/C9-kL2mNoPq", username: "some.creator" },
    });

    const docs = await db.collection("entries").find({}).toArray();
    expect(docs).toHaveLength(1);
    const { _id, ...stored } = docs[0];
    expect(_id).toBeDefined();
    expect(stored).toEqual({
      url: "https://www.instagram.com/reel/C9-kL2mNoPq",
      username: "some.creator",
      createdAt: NOW,
      drawDate: null,
    });
  });

  it("creates a unique index on the normalised url", async () => {
    const db = mongo.freshDb();
    await handleCreateEntry(submit(entry("https://www.instagram.com/p/DAbc123xYz_/")), deps(db));
    const indexes = await db.collection("entries").indexes();
    expect(indexes.find((index) => index.key.url === 1)?.unique).toBe(true);
  });

  it("rejects duplicates, including other link formats for the same post", async () => {
    const db = mongo.freshDb();
    const first = await handleCreateEntry(submit(entry("https://www.instagram.com/p/C9-kL2mNoPq/")), deps(db));
    expect(first.status).toBe(201);

    for (const url of [
      "https://www.instagram.com/p/C9-kL2mNoPq/",
      "instagram.com/p/C9-kL2mNoPq?igsh=xyz",
      "https://m.instagram.com/someone/p/C9-kL2mNoPq/",
      "https://www.instagram.com/reel/C9-kL2mNoPq/",
      "https://www.instagram.com/tv/C9-kL2mNoPq",
    ]) {
      const again = await handleCreateEntry(submit(entry(url, "other"), { ip: "198.51.100.1" }), deps(db));
      expect(again.status, url).toBe(409);
      expect(await again.json()).toMatchObject({ ok: false, code: "duplicate", field: "url" });
    }
    expect(await db.collection("entries").countDocuments()).toBe(1);
  });

  it("rejects duplicates submitted at the same moment", async () => {
    const db = mongo.freshDb();
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        handleCreateEntry(
          submit(entry("https://www.instagram.com/p/RaceCondition1/"), { ip: `198.51.100.${i + 1}` }),
          deps(db),
        ),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    expect(await db.collection("entries").countDocuments()).toBe(1);
  });

  it("rejects links that aren't Instagram posts, pointing at the link field", async () => {
    const db = mongo.freshDb();
    const response = await handleCreateEntry(
      submit(entry("https://www.instagram.com/stories/someone/123/")),
      deps(db),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "invalid_url",
      field: "url",
      message: expect.stringContaining("/p/, /reel/ or /tv/"),
    });
    expect(await db.collection("entries").countDocuments()).toBe(0);
  });

  it("rejects a missing or invalid username, pointing at the username field", async () => {
    const db = mongo.freshDb();
    for (const username of ["", "not a username", "x".repeat(31)]) {
      const response = await handleCreateEntry(
        submit(entry("https://www.instagram.com/p/DAbc123xYz_/", username)),
        deps(db),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "invalid_username", field: "username" });
    }
    expect(await db.collection("entries").countDocuments()).toBe(0);
  });

  it("rejects bad request bodies", async () => {
    const db = mongo.freshDb();
    expect((await handleCreateEntry(submit("{not json"), deps(db))).status).toBe(400);
    expect(
      (await handleCreateEntry(submit("url=x", { contentType: "application/x-www-form-urlencoded" }), deps(db)))
        .status,
    ).toBe(415);
    const huge = JSON.stringify(entry(`https://www.instagram.com/p/A/?x=${"a".repeat(9000)}`));
    expect((await handleCreateEntry(submit(huge), deps(db))).status).toBe(413);
  });

  describe("Turnstile", () => {
    it("rejects the entry when the check fails", async () => {
      const db = mongo.freshDb();
      const failing = vi.fn<TurnstileVerifier>(async () => ({ success: false, errorCodes: ["invalid-input-response"] }));
      const response = await handleCreateEntry(
        submit(entry("https://www.instagram.com/p/DAbc123xYz_/")),
        deps(db, { verifyTurnstile: failing }),
      );
      expect(response.status).toBe(403);
      expect(failing).toHaveBeenCalledWith("token", "203.0.113.7");
      expect(await db.collection("entries").countDocuments()).toBe(0);
    });

    it("refuses entries in production when no Turnstile secret is configured", async () => {
      const db = mongo.freshDb();
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
      const response = await handleCreateEntry(
        submit(entry("https://www.instagram.com/p/DAbc123xYz_/")),
        deps(db, { verifyTurnstile: null, requireTurnstile: true }),
      );
      expect(response.status).toBe(503);
      expect(await db.collection("entries").countDocuments()).toBe(0);
      errorLog.mockRestore();
    });

    it("skips the check in local development when no secret is configured", async () => {
      const db = mongo.freshDb();
      const response = await handleCreateEntry(
        submit({ url: "https://www.instagram.com/p/DAbc123xYz_/", username: "someone" }),
        deps(db, { verifyTurnstile: null, requireTurnstile: false }),
      );
      expect(response.status).toBe(201);
    });
  });

  it("rate limits each IP, counting every attempt", async () => {
    const db = mongo.freshDb();
    for (let i = 0; i < SUBMIT_RATE_LIMIT.limit; i++) {
      const response = await handleCreateEntry(submit(entry("nope")), deps(db));
      expect(response.status).toBe(400);
    }
    const blocked = await handleCreateEntry(submit(entry("https://www.instagram.com/p/DAbc123xYz_/")), deps(db));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await db.collection("entries").countDocuments()).toBe(0);

    const otherIp = await handleCreateEntry(
      submit(entry("https://www.instagram.com/p/DAbc123xYz_/"), { ip: "198.51.100.9" }),
      deps(db),
    );
    expect(otherIp.status).toBe(201);
  });

  it("ignores x-forwarded-for, which clients can spoof", async () => {
    const db = mongo.freshDb();
    const spoofed = (i: number) =>
      new Request("http://localhost/api/entries", {
        method: "POST",
        headers: { "content-type": "application/json", "x-real-ip": "203.0.113.50", "x-forwarded-for": `10.0.0.${i}` },
        body: JSON.stringify(entry("nope")),
      });
    for (let i = 0; i < SUBMIT_RATE_LIMIT.limit; i++) await handleCreateEntry(spoofed(i), deps(db));
    expect((await handleCreateEntry(spoofed(99), deps(db))).status).toBe(429);
  });

  it("never stores raw IP addresses", async () => {
    const db = mongo.freshDb();
    await handleCreateEntry(submit(entry("https://www.instagram.com/p/DAbc123xYz_/")), deps(db));
    const counters = await db.collection("rate_limits").find({}).toArray();
    expect(counters).toHaveLength(1);
    expect(JSON.stringify(counters)).not.toContain("203.0.113.7");
    expect(JSON.stringify(await db.collection("entries").find({}).toArray())).not.toContain("203.0.113.7");
  });

  it("answers 503 when the database is unavailable", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await handleCreateEntry(submit(entry("https://www.instagram.com/p/DAbc123xYz_/")), {
      ...deps(mongo.freshDb()),
      getDb: () => {
        throw new Error("connection refused");
      },
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, code: "unavailable" });
    errorLog.mockRestore();
  });
});
