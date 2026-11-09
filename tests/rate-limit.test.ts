import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureIndexes } from "@/lib/collections";
import { consumeRateLimit, hashSubject, rateLimitSubject } from "@/lib/rate-limit";
import { startTestMongo } from "./support/mongo";

describe("rateLimitSubject", () => {
  it("uses IPv4 addresses as they are", () => {
    expect(rateLimitSubject("203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitSubject(" 203.0.113.7 ")).toBe("203.0.113.7");
  });

  it("unwraps IPv4-mapped IPv6 addresses", () => {
    expect(rateLimitSubject("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  it("groups IPv6 addresses by their /64 network", () => {
    const a = rateLimitSubject("2001:db8:1:2::a");
    expect(a).toBe("2001:0db8:0001:0002::/64");
    expect(rateLimitSubject("2001:DB8:1:2:ffff:ffff:ffff:ffff")).toBe(a);
    expect(rateLimitSubject("[2001:db8:1:2::b]")).toBe(a);
    expect(rateLimitSubject("2001:db8:1:3::a")).not.toBe(a);
    expect(rateLimitSubject("fe80::1%eth0")).toBe("fe80:0000:0000:0000::/64");
    expect(rateLimitSubject("::1")).toBe("0000:0000:0000:0000::/64");
    expect(rateLimitSubject("64:ff9b::192.0.2.1")).toBe("0064:ff9b:0000:0000::/64");
  });

  it("falls back safely for missing or odd values", () => {
    expect(rateLimitSubject(null)).toBe("unknown");
    expect(rateLimitSubject("")).toBe("unknown");
    expect(rateLimitSubject("1::2::3")).toBe("1::2::3");
  });
});

describe("hashSubject", () => {
  it("never returns the raw address", () => {
    const hashed = hashSubject("203.0.113.7", "secret");
    expect(hashed).toMatch(/^[0-9a-f]{32}$/);
    expect(hashed).not.toContain("203");
  });

  it("depends on the secret", () => {
    expect(hashSubject("203.0.113.7", "one")).not.toBe(hashSubject("203.0.113.7", "two"));
    expect(hashSubject("203.0.113.7", undefined)).toBe(hashSubject("203.0.113.7", undefined));
  });
});

describe("consumeRateLimit (MongoDB)", () => {
  let mongo: Awaited<ReturnType<typeof startTestMongo>>;
  beforeAll(async () => {
    mongo = await startTestMongo();
  });
  afterAll(async () => {
    await mongo?.stop();
  });

  const rule = { limit: 3, windowMs: 60_000 };

  it("allows up to the limit in a window, then blocks", async () => {
    const db = mongo.freshDb();
    await ensureIndexes(db);
    const now = new Date("2026-11-09T10:00:05Z");
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await consumeRateLimit(db, "submit:a", rule, now));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3].retryAfterSeconds).toBe(55);
  });

  it("starts again in the next window and keeps buckets separate", async () => {
    const db = mongo.freshDb();
    await ensureIndexes(db);
    const now = new Date("2026-11-09T10:00:00Z");
    for (let i = 0; i < 3; i++) await consumeRateLimit(db, "submit:a", rule, now);
    expect((await consumeRateLimit(db, "submit:a", rule, now)).allowed).toBe(false);
    expect((await consumeRateLimit(db, "submit:b", rule, now)).allowed).toBe(true);
    const later = new Date(now.getTime() + 60_000);
    expect((await consumeRateLimit(db, "submit:a", rule, later)).allowed).toBe(true);
  });

  it("counts concurrent first requests correctly", async () => {
    const db = mongo.freshDb();
    await ensureIndexes(db);
    const now = new Date("2026-11-09T10:00:00Z");
    const results = await Promise.all(
      Array.from({ length: 8 }, () => consumeRateLimit(db, "submit:burst", rule, now)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
  });

  it("stores counters with an expiry for the TTL index", async () => {
    const db = mongo.freshDb();
    await ensureIndexes(db);
    await consumeRateLimit(db, "submit:ttl", rule, new Date("2026-11-09T10:00:30Z"));
    const doc = await db.collection("rate_limits").findOne({});
    expect(doc?.expiresAt).toEqual(new Date("2026-11-09T10:01:00Z"));
    const indexes = await db.collection("rate_limits").indexes();
    expect(indexes.find((index) => index.key.expiresAt === 1)?.expireAfterSeconds).toBe(0);
  });
});
