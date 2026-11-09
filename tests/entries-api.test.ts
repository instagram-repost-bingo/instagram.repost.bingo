import type { Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { handleCreateEntry, type CreateEntryDeps } from "@/lib/api/create-entry";
import { SUBMIT_RATE_LIMIT } from "@/lib/config";
import type { OwnerLookup } from "@/lib/instagram-owner";
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
const ownerIs = (username: string) => vi.fn<OwnerLookup>(async () => ({ ok: true, username }));

function deps(db: Db, overrides: Partial<CreateEntryDeps> = {}): CreateEntryDeps {
  return {
    getDb: () => db,
    verifyTurnstile: passTurnstile,
    requireTurnstile: true,
    rateLimitSecret: "test-secret",
    lookupOwner: ownerIs("slashie.app"),
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

const entry = (url: string) => ({ url, turnstileToken: "token" });

describe("POST /api/entries", () => {
  it("stores the shared shape, with the username Instagram says owns the post", async () => {
    const db = mongo.freshDb();
    const lookupOwner = ownerIs("slashie.app");
    const response = await handleCreateEntry(
      submit(entry("https://www.instagram.com/p/DfiOsp6t354/?utm_source=ig_web_button_share_sheet&rpxt=MzRlODBiNWFlZA==")),
      deps(db, { lookupOwner }),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      entry: { url: "https://www.instagram.com/p/DfiOsp6t354", username: "slashie.app" },
    });
    expect(body.message).toContain("@slashie.app");
    expect(lookupOwner).toHaveBeenCalledWith(expect.objectContaining({ shortcode: "DfiOsp6t354" }));

    const docs = await db.collection("entries").find({}).toArray();
    expect(docs).toHaveLength(1);
    const { _id, ...stored } = docs[0];
    expect(_id).toBeDefined();
    expect(stored).toEqual({
      url: "https://www.instagram.com/p/DfiOsp6t354",
      username: "slashie.app",
      createdAt: NOW,
      drawDate: null,
    });
  });

  it("ignores a username sent by the client", async () => {
    const db = mongo.freshDb();
    await handleCreateEntry(
      submit({ ...entry("https://www.instagram.com/p/DfiOsp6t354/"), username: "someone.else" }),
      deps(db),
    );
    expect((await db.collection("entries").findOne({}))?.username).toBe("slashie.app");
  });

  it("rejects posts Instagram can't show publicly (missing, deleted or private)", async () => {
    const db = mongo.freshDb();
    const response = await handleCreateEntry(
      submit(entry("https://www.instagram.com/p/DfiOsp6t354/")),
      deps(db, { lookupOwner: vi.fn<OwnerLookup>(async () => ({ ok: false, reason: "not_public" })) }),
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "not_public", message: expect.stringContaining("public") });
    expect(await db.collection("entries").countDocuments()).toBe(0);
  });

  it("asks people to try again when Instagram doesn't answer", async () => {
    const db = mongo.freshDb();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = await handleCreateEntry(
      submit(entry("https://www.instagram.com/p/DfiOsp6t354/")),
      deps(db, { lookupOwner: vi.fn<OwnerLookup>(async () => ({ ok: false, reason: "unavailable" })) }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "instagram_unavailable" });
    expect(await db.collection("entries").countDocuments()).toBe(0);
    warn.mockRestore();
  });

  it("rejects posts by the repost.bingo account itself", async () => {
    const db = mongo.freshDb();
    const response = await handleCreateEntry(
      submit(entry("https://www.instagram.com/p/OurOwnPost1/")),
      deps(db, { lookupOwner: ownerIs("insta.repost.bingo") }),
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "own_post" });
  });

  it("rejects duplicates in any link format without asking Instagram again", async () => {
    const db = mongo.freshDb();
    expect((await handleCreateEntry(submit(entry("https://www.instagram.com/p/C9-kL2mNoPq/")), deps(db))).status).toBe(201);

    const lookupOwner = ownerIs("slashie.app");
    for (const url of [
      "https://www.instagram.com/p/C9-kL2mNoPq/",
      "instagram.com/p/C9-kL2mNoPq?igsh=xyz",
      "https://m.instagram.com/someone/p/C9-kL2mNoPq/",
      "https://www.instagram.com/reel/C9-kL2mNoPq/",
      "https://www.instagram.com/tv/C9-kL2mNoPq",
    ]) {
      const again = await handleCreateEntry(submit(entry(url), { ip: "198.51.100.1" }), deps(db, { lookupOwner }));
      expect(again.status, url).toBe(409);
      expect(await again.json()).toMatchObject({ ok: false, code: "duplicate" });
    }
    expect(lookupOwner).not.toHaveBeenCalled();
    expect(await db.collection("entries").countDocuments()).toBe(1);
  });

  it("rejects duplicates submitted at the same moment", async () => {
    const db = mongo.freshDb();
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        handleCreateEntry(submit(entry("https://www.instagram.com/p/RaceCondition1/"), { ip: `198.51.100.${i + 1}` }), deps(db)),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    expect(await db.collection("entries").countDocuments()).toBe(1);
  });

  it("rejects links that aren't Instagram posts", async () => {
    const db = mongo.freshDb();
    const lookupOwner = ownerIs("slashie.app");
    const response = await handleCreateEntry(
      submit(entry("https://www.instagram.com/stories/someone/123/")),
      deps(db, { lookupOwner }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "invalid_url",
      message: expect.stringContaining("/p/, /reel/ or /tv/"),
    });
    expect(lookupOwner).not.toHaveBeenCalled();
  });

  it("rejects bad request bodies", async () => {
    const db = mongo.freshDb();
    expect((await handleCreateEntry(submit("{not json"), deps(db))).status).toBe(400);
    expect(
      (await handleCreateEntry(submit("url=x", { contentType: "application/x-www-form-urlencoded" }), deps(db))).status,
    ).toBe(415);
    const huge = JSON.stringify(entry(`https://www.instagram.com/p/A/?x=${"a".repeat(9000)}`));
    expect((await handleCreateEntry(submit(huge), deps(db))).status).toBe(413);
  });

  describe("Turnstile", () => {
    it("rejects the entry, without asking Instagram, when the check fails", async () => {
      const db = mongo.freshDb();
      const failing = vi.fn<TurnstileVerifier>(async () => ({ success: false, errorCodes: ["invalid-input-response"] }));
      const lookupOwner = ownerIs("slashie.app");
      const response = await handleCreateEntry(
        submit(entry("https://www.instagram.com/p/DfiOsp6t354/")),
        deps(db, { verifyTurnstile: failing, lookupOwner }),
      );
      expect(response.status).toBe(403);
      expect(failing).toHaveBeenCalledWith("token", "203.0.113.7");
      expect(lookupOwner).not.toHaveBeenCalled();
      expect(await db.collection("entries").countDocuments()).toBe(0);
    });

    it("refuses entries in production when no Turnstile secret is configured", async () => {
      const db = mongo.freshDb();
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
      const response = await handleCreateEntry(
        submit(entry("https://www.instagram.com/p/DfiOsp6t354/")),
        deps(db, { verifyTurnstile: null, requireTurnstile: true }),
      );
      expect(response.status).toBe(503);
      expect(await db.collection("entries").countDocuments()).toBe(0);
      errorLog.mockRestore();
    });

    it("skips the check in local development when no secret is configured", async () => {
      const db = mongo.freshDb();
      const response = await handleCreateEntry(
        submit({ url: "https://www.instagram.com/p/DfiOsp6t354/" }),
        deps(db, { verifyTurnstile: null, requireTurnstile: false }),
      );
      expect(response.status).toBe(201);
    });
  });

  it("rate limits each IP, counting every attempt", async () => {
    const db = mongo.freshDb();
    for (let i = 0; i < SUBMIT_RATE_LIMIT.limit; i++) {
      expect((await handleCreateEntry(submit(entry("nope")), deps(db))).status).toBe(400);
    }
    const blocked = await handleCreateEntry(submit(entry("https://www.instagram.com/p/DfiOsp6t354/")), deps(db));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await db.collection("entries").countDocuments()).toBe(0);

    const otherIp = await handleCreateEntry(
      submit(entry("https://www.instagram.com/p/DfiOsp6t354/"), { ip: "198.51.100.9" }),
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
    await handleCreateEntry(submit(entry("https://www.instagram.com/p/DfiOsp6t354/")), deps(db));
    const counters = await db.collection("rate_limits").find({}).toArray();
    expect(counters).toHaveLength(1);
    expect(JSON.stringify(counters)).not.toContain("203.0.113.7");
    expect(JSON.stringify(await db.collection("entries").find({}).toArray())).not.toContain("203.0.113.7");
  });

  it("answers 503 when the database is unavailable", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await handleCreateEntry(submit(entry("https://www.instagram.com/p/DfiOsp6t354/")), {
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
