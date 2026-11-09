import "server-only";
import { createHash, createHmac } from "node:crypto";
import type { Db } from "mongodb";
import { rateLimitsCollection } from "./collections";
import { isDuplicateKeyError } from "./http";

export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  retryAfterSeconds: number;
}

/**
 * Fixed-window counter in MongoDB. Each call counts one attempt for `bucket`.
 * Counters expire with their window through the TTL index on expiresAt.
 */
export async function consumeRateLimit(
  db: Db,
  bucket: string,
  rule: RateLimitRule,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const windowStart = Math.floor(now.getTime() / rule.windowMs) * rule.windowMs;
  const windowEnd = windowStart + rule.windowMs;
  const filter = { _id: `${bucket}:${windowStart}` };
  const update = {
    $inc: { count: 1 },
    $setOnInsert: { expiresAt: new Date(windowEnd) },
  };
  const options = { upsert: true, returnDocument: "after" as const };

  let doc;
  try {
    doc = await rateLimitsCollection(db).findOneAndUpdate(filter, update, options);
  } catch (error) {
    // Two first requests in a window can race to create the counter. Retry once as an update.
    if (!isDuplicateKeyError(error)) throw error;
    doc = await rateLimitsCollection(db).findOneAndUpdate(filter, update, options);
  }

  const count = doc?.count ?? 1;
  return {
    allowed: count <= rule.limit,
    count,
    retryAfterSeconds: Math.max(1, Math.ceil((windowEnd - now.getTime()) / 1000)),
  };
}

/**
 * The unit we limit: the address for IPv4, and the /64 network for IPv6
 * (one device or home usually controls a whole /64).
 */
export function rateLimitSubject(ip: string | null | undefined): string {
  if (!ip) return "unknown";
  const value = ip.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");

  const mappedIpv4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (mappedIpv4) return mappedIpv4[1];
  if (!value.includes(":")) return value;

  const groups = expandIpv6(value);
  return groups ? `${groups.slice(0, 4).join(":")}::/64` : value;
}

/** Keyed hash of the subject, so raw IP addresses are never stored. */
export function hashSubject(subject: string, secret: string | undefined): string {
  const digest = secret
    ? createHmac("sha256", secret).update(subject)
    : createHash("sha256").update(`repost.bingo:${subject}`);
  return digest.digest("hex").slice(0, 32);
}

function expandIpv6(address: string): string[] | null {
  let value = address;

  // Trailing embedded IPv4 (e.g. 64:ff9b::192.0.2.1) becomes two hex groups.
  const embedded = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (embedded) {
    const octets = embedded.slice(1).map(Number);
    if (octets.some((octet) => octet > 255)) return null;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    value = `${value.slice(0, -embedded[0].length)}${high}:${low}`;
  }

  const halves = value.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;

  const groups = [...head, ...new Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => group.padStart(4, "0"));
}
