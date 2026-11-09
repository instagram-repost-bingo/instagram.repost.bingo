import "server-only";
import { parseInstagramUsername, type InstagramPost } from "./instagram";

// Finds who owns a post by reading Instagram's public embed page, the page
// Instagram serves for embedding posts on other websites. It names the owner,
// and Instagram doesn't serve embeds of private posts, so "we can read the
// owner" also means "the post exists and is public".
//
// This isn't an official API (Instagram has none for this), so it can break if
// Instagram changes its markup, and Instagram may rate-limit our servers.

export type OwnerLookupResult =
  | { ok: true; username: string }
  /** The post doesn't exist, was deleted, or is from a private account. */
  | { ok: false; reason: "not_public" }
  /** Instagram didn't answer usefully (rate limit, login wall, timeout). */
  | { ok: false; reason: "unavailable" };

export type OwnerLookup = (post: InstagramPost) => Promise<OwnerLookupResult>;

const USER_AGENT = "Mozilla/5.0 (compatible; repost.bingo/1.0; +https://repost.bingo)";
const TIMEOUT_MS = 6_000;

type Page = { kind: "page"; html: string } | { kind: "missing" } | { kind: "blocked" };

export function createOwnerLookup(fetchImpl: typeof fetch = fetch): OwnerLookup {
  return async (post) => {
    // 1. The embed page: light, meant for other sites, and less rate-limited.
    const embed = await fetchPage(fetchImpl, `https://www.instagram.com/p/${post.shortcode}/embed/`);
    if (embed.kind === "page") {
      const owner = ownerFromEmbedHtml(embed.html);
      return owner ? { ok: true, username: owner } : { ok: false, reason: "not_public" };
    }
    if (embed.kind === "missing") return { ok: false, reason: "not_public" };

    // 2. The embed was blocked: try the post page, which names the owner in og:url.
    const page = await fetchPage(fetchImpl, `https://www.instagram.com/p/${post.shortcode}/`);
    if (page.kind === "page") {
      const owner = ownerFromPostPageHtml(page.html, post.shortcode);
      // Without owner details this is most likely a login wall, not a missing post.
      return owner ? { ok: true, username: owner } : { ok: false, reason: "unavailable" };
    }
    if (page.kind === "missing") return { ok: false, reason: "not_public" };
    return { ok: false, reason: "unavailable" };
  };
}

/** Owner from the embed header: <a class="Username" ...><span class="UsernameText">name</span>. */
export function ownerFromEmbedHtml(html: string): string | null {
  const candidates = [
    /<span class="UsernameText">([^<]{1,40})<\/span>/.exec(html)?.[1],
    /<a class="Username" href="https:\/\/www\.instagram\.com\/([^/"?]{1,40})\/?\?/.exec(html)?.[1],
  ];
  for (const candidate of candidates) {
    const username = candidate ? parseInstagramUsername(candidate) : null;
    if (username?.ok) return username.username;
  }
  return null;
}

/** Owner from the post page's og:url, e.g. https://www.instagram.com/name/p/SHORTCODE/. */
export function ownerFromPostPageHtml(html: string, shortcode: string): string | null {
  const ogUrl = /<meta property="og:url" content="([^"]+)"/.exec(html)?.[1];
  const match = ogUrl
    ? /^https:\/\/www\.instagram\.com\/([^/]+)\/(?:p|reel|tv)\/([^/]+)\/?$/.exec(ogUrl)
    : null;
  if (!match || match[2] !== shortcode) return null;
  const username = parseInstagramUsername(match[1]);
  return username.ok ? username.username : null;
}

async function fetchPage(fetchImpl: typeof fetch, url: string): Promise<Page> {
  try {
    const response = await fetchImpl(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html", "Accept-Language": "en-GB,en;q=0.9" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 404 || response.status === 410) return { kind: "missing" };
    // Rate limits and login walls end on the login page or a non-200 status.
    if (!response.ok || response.url.includes("/accounts/login")) return { kind: "blocked" };
    return { kind: "page", html: await response.text() };
  } catch {
    return { kind: "blocked" };
  }
}
