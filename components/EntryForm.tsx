"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { INSTAGRAM_HANDLE } from "@/lib/config";
import { describeLinkFailure, parseInstagramPostUrl } from "@/lib/instagram";
import { useTurnstile } from "./useTurnstile";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

interface EntryResponse {
  ok?: boolean;
  message?: string;
}

export function EntryForm({ turnstileSiteKey }: { turnstileSiteKey?: string }) {
  const router = useRouter();
  const linkRef = useRef<HTMLInputElement>(null);
  // Set synchronously, so a fast double tap can't send the entry twice.
  const inFlight = useRef(false);
  const [link, setLink] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const turnstileEnabled = Boolean(turnstileSiteKey);
  const {
    containerRef: turnstileContainerRef,
    prepare: prepareTurnstile,
    getToken: getTurnstileToken,
    reset: resetTurnstile,
  } = useTurnstile(turnstileSiteKey);

  function showError(message: string) {
    setStatus({ kind: "error", message });
    linkRef.current?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    // Same validation as the server, for instant feedback.
    const parsed = parseInstagramPostUrl(link);
    if (!parsed.ok) return showError(describeLinkFailure(parsed.reason));

    inFlight.current = true;
    setStatus({ kind: "submitting" });
    try {
      let turnstileToken: string | undefined;
      if (turnstileEnabled) {
        turnstileToken = (await getTurnstileToken()) ?? undefined;
        if (!turnstileToken) {
          showError("Please finish the quick check under the button, then try again.");
          return;
        }
      }

      const response = await fetch("/api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: link, turnstileToken }),
      });
      const data = (await response.json().catch(() => null)) as EntryResponse | null;

      if (response.ok && data?.ok) {
        setStatus({ kind: "success", message: data.message ?? "You're in!" });
        setLink("");
        // Refresh the server-rendered lists so this entry shows up.
        router.refresh();
      } else {
        showError(data?.message ?? "Something went wrong. Please try again.");
      }
    } catch {
      showError("We couldn't reach repost.bingo. Check your connection and try again.");
    } finally {
      inFlight.current = false;
      resetTurnstile();
    }
  }

  const submitting = status.kind === "submitting";

  return (
    <form className="entry-form" onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label className="field__label" htmlFor="post-link">
          Your Instagram post link
        </label>
        <input
          ref={linkRef}
          id="post-link"
          name="url"
          className="field__input"
          type="url"
          inputMode="url"
          enterKeyHint="go"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="https://www.instagram.com/p/..."
          value={link}
          onChange={(event) => setLink(event.target.value)}
          onFocus={() => void prepareTurnstile().catch(() => {})}
          aria-invalid={status.kind === "error"}
          aria-describedby="post-link-hint entry-status"
          required
        />
        <div id="post-link-hint" className="field__hints">
          <p className="field__hint">
            Links with /p/, /reel/ or /tv/ work. In Instagram: Share, then Copy link.
          </p>
          {/* Following is a stated rule only: nothing in this repo checks it. */}
          <p className="field__hint">
            To enter you must follow @{INSTAGRAM_HANDLE}, and your account must be public so we can see
            who posted it.
          </p>
        </div>
      </div>

      <button
        className="button button--accent entry-form__submit"
        type="submit"
        disabled={submitting}
        aria-describedby="entry-consent"
      >
        {submitting ? "Checking your post..." : "Submit"}
      </button>

      <p id="entry-consent" className="entry-form__consent">
        By entering you confirm it&apos;s your own post and allow us to repost it with credit.
      </p>

      {turnstileEnabled ? <div ref={turnstileContainerRef} className="entry-form__turnstile" /> : null}

      {/* Always in the DOM so screen readers announce changes. */}
      <div id="entry-status" role="status" aria-live="polite" aria-atomic="true">
        {status.kind === "success" || status.kind === "error" ? (
          <p className={`entry-form__message entry-form__message--${status.kind}`}>
            <span className="entry-form__message-icon" aria-hidden="true">
              {status.kind === "success" ? "✓" : "!"}
            </span>
            <span>{status.message}</span>
          </p>
        ) : null}
      </div>
    </form>
  );
}
