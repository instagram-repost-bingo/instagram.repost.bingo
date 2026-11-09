"use client";

import { useCallback, useEffect, useRef } from "react";

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptLoading: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptLoading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptLoading = null;
      reject(new Error("Turnstile failed to load"));
    };
    document.head.appendChild(script);
  });
  return scriptLoading;
}

/**
 * Optional Cloudflare Turnstile widget. Does nothing without a site key.
 * The script only loads when someone starts using the form (call `prepare`),
 * and the widget stays invisible unless Cloudflare needs the person to click.
 */
export function useTurnstile(siteKey: string | undefined) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const token = useRef<string | null>(null);
  const waiting = useRef<Array<(value: string | null) => void>>([]);

  const prepare = useCallback(async () => {
    if (!siteKey || widgetId.current) return;
    await loadTurnstileScript();
    const container = containerRef.current;
    if (!window.turnstile || !container || widgetId.current) return;
    widgetId.current = window.turnstile.render(container, {
      sitekey: siteKey,
      action: "submit_entry",
      appearance: "interaction-only",
      size: "flexible",
      theme: "light",
      callback: (value: string) => {
        token.current = value;
        for (const resolve of waiting.current.splice(0)) resolve(value);
      },
      "expired-callback": () => {
        token.current = null;
      },
      "error-callback": () => {
        token.current = null;
        // Don't leave the form waiting: report "no token" straight away.
        for (const resolve of waiting.current.splice(0)) resolve(null);
      },
    });
  }, [siteKey]);

  /** Resolves with a fresh token, or null if none arrives in time. */
  const getToken = useCallback(
    async (timeoutMs = 20_000): Promise<string | null> => {
      if (!siteKey) return null;
      try {
        await prepare();
      } catch {
        return null;
      }
      if (token.current) return token.current;
      return new Promise<string | null>((resolve) => {
        const done = (value: string | null) => {
          clearTimeout(timer);
          waiting.current = waiting.current.filter((fn) => fn !== done);
          resolve(value);
        };
        const timer = setTimeout(() => done(null), timeoutMs);
        waiting.current.push(done);
      });
    },
    [prepare, siteKey],
  );

  /** Tokens are single use: get a new one after every submit attempt. */
  const reset = useCallback(() => {
    token.current = null;
    if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
  }, []);

  useEffect(
    () => () => {
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    },
    [],
  );

  return { containerRef, prepare, getToken, reset };
}
