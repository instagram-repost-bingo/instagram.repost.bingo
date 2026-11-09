import { handleCreateEntry } from "@/lib/api/create-entry";
import { getDb } from "@/lib/mongodb";
import { createTurnstileVerifier } from "@/lib/turnstile";

export async function POST(request: Request): Promise<Response> {
  const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
  return handleCreateEntry(request, {
    getDb,
    verifyTurnstile: createTurnstileVerifier(turnstileSecret),
    // Fail closed in production (including Vercel previews); skip only in local dev.
    requireTurnstile: process.env.NODE_ENV === "production",
    // The Turnstile secret doubles as the key for hashing IPs, so raw IPs are never stored.
    rateLimitSecret: turnstileSecret,
  });
}
