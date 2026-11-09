import "server-only";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_TOKEN_LENGTH = 2048;

export interface TurnstileResult {
  success: boolean;
  errorCodes: string[];
}

export type TurnstileVerifier = (
  token: unknown,
  remoteIp: string | null,
) => Promise<TurnstileResult>;

/**
 * Server-side Cloudflare Turnstile check. Returns null (bot check off) when no
 * secret key is configured. Fails closed if Cloudflare can't be reached.
 */
export function createTurnstileVerifier(
  secret: string | undefined,
  fetchImpl: typeof fetch = fetch,
): TurnstileVerifier | null {
  if (!secret) return null;

  return async (token, remoteIp) => {
    if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
      return { success: false, errorCodes: ["missing-input-response"] };
    }

    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);

    try {
      const response = await fetchImpl(VERIFY_URL, {
        method: "POST",
        body,
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return { success: false, errorCodes: [`http-${response.status}`] };
      const data = (await response.json()) as { success?: unknown; "error-codes"?: unknown };
      const errorCodes = Array.isArray(data["error-codes"])
        ? data["error-codes"].filter((code): code is string => typeof code === "string")
        : [];
      return { success: data.success === true, errorCodes };
    } catch {
      return { success: false, errorCodes: ["verify-request-failed"] };
    }
  };
}
