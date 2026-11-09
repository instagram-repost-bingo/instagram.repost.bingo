/** JSON response that is never cached. */
export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

/** MongoDB E11000: a unique index rejected the write. */
export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

/**
 * Client IP as set by Vercel's proxy in x-real-ip (a client can't spoof it on
 * Vercel). x-forwarded-for is deliberately ignored: without a trusted proxy in
 * front it can be set by anyone. Locally there is no header, so all requests
 * share one rate-limit bucket.
 */
export function clientIp(headers: Headers): string | null {
  return headers.get("x-real-ip")?.trim() || null;
}
