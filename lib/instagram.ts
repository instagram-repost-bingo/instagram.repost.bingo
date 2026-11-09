// Validating and normalising Instagram post links and usernames.
// Pure functions with no secrets: safe to import from client components.

export type PostKind = "p" | "reel" | "tv";

export const POST_KINDS: readonly PostKind[] = ["p", "reel", "tv"];

export interface InstagramPost {
  kind: PostKind;
  shortcode: string;
  /**
   * The normalised link stored in `entries.url` (unique):
   * https, lowercase host (always www.instagram.com), no username prefix,
   * no query string or #fragment, no trailing slash.
   * e.g. https://www.instagram.com/reel/C9-kL2mNoPq
   */
  url: string;
}

export type LinkFailure = "empty" | "too_long" | "not_a_url" | "not_instagram" | "not_a_post";

export type LinkResult = { ok: true; post: InstagramPost } | { ok: false; reason: LinkFailure };

export type UsernameFailure = "empty" | "invalid";

export type UsernameResult = { ok: true; username: string } | { ok: false; reason: UsernameFailure };

export const MAX_LINK_LENGTH = 2048;

const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com", "m.instagram.com"]);

/** Path words that point at a single post. "reels" is how some share links spell "reel". */
const KIND_ALIASES = new Map<string, PostKind>([
  ["p", "p"],
  ["reel", "reel"],
  ["reels", "reel"],
  ["tv", "tv"],
]);

// Shortcodes use the URL-safe base64 alphabet. Case matters, so never lowercase them.
const SHORTCODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
// Instagram usernames: letters, numbers, full stops and underscores, up to 30 characters.
const USERNAME_CHARS = /^[a-z0-9._]{1,30}$/;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const PROFILE_LINK = /^(?:https?:\/\/)?(?:www\.|m\.)?instagram\.com\/([^/?#\s]+)\/?(?:[?#]\S*)?$/i;

/**
 * Validates a pasted Instagram post link and normalises it.
 *
 * Accepts instagram.com links to /p/, /reel/ (or /reels/) and /tv/, with or
 * without https://, www. or m., with an optional /<username>/ prefix (newer
 * share links), and with any query string or #fragment (e.g. ?igsh=...).
 */
export function parseInstagramPostUrl(input: unknown): LinkResult {
  if (typeof input !== "string") return linkFailure("empty");

  const trimmed = input.trim();
  if (trimmed === "") return linkFailure("empty");
  if (trimmed.length > MAX_LINK_LENGTH) return linkFailure("too_long");
  if (/\s/.test(trimmed)) return linkFailure("not_a_url");

  // People often paste "instagram.com/p/..." without the https:// part.
  const candidate = HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return linkFailure("not_a_url");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return linkFailure("not_a_url");
  if (url.username !== "" || url.password !== "" || url.port !== "") {
    return linkFailure("not_instagram");
  }
  // URL lowercases the hostname, so "WWW.Instagram.COM" matches too.
  if (!INSTAGRAM_HOSTS.has(url.hostname)) return linkFailure("not_instagram");

  const segments = url.pathname.split("/").filter((segment) => segment !== "");
  const match =
    matchKindAndShortcode(segments) ??
    (segments.length === 3 && USERNAME_CHARS.test(segments[0].toLowerCase())
      ? matchKindAndShortcode(segments.slice(1))
      : null);

  if (!match) return linkFailure("not_a_post");
  return { ok: true, post: buildPost(match.kind, match.shortcode) };
}

export function buildPost(kind: PostKind, shortcode: string): InstagramPost {
  return { kind, shortcode, url: `https://www.instagram.com/${kind}/${shortcode}` };
}

/**
 * The same post can be reached at /p/, /reel/ and /tv/. These are all the
 * normalised links it could have been entered under, for duplicate checks.
 */
export function postUrlVariants(shortcode: string): string[] {
  return POST_KINDS.map((kind) => buildPost(kind, shortcode).url);
}

/**
 * Validates an Instagram username and normalises it to lowercase without "@".
 * Also accepts a pasted profile link such as instagram.com/someone.
 */
export function parseInstagramUsername(input: unknown): UsernameResult {
  if (typeof input !== "string") return { ok: false, reason: "empty" };

  let value = input.trim();
  const profile = PROFILE_LINK.exec(value);
  if (profile) value = profile[1];
  value = value.replace(/^@/, "").toLowerCase();

  if (value === "") return { ok: false, reason: "empty" };
  if (
    !USERNAME_CHARS.test(value) ||
    value.startsWith(".") ||
    value.endsWith(".") ||
    value.includes("..")
  ) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, username: value };
}

/** Friendly copy for each link failure, shared by the form and the API. */
export function describeLinkFailure(reason: LinkFailure): string {
  switch (reason) {
    case "empty":
      return "Paste the link to your Instagram post first.";
    case "too_long":
      return "That link is too long to be an Instagram post link.";
    case "not_a_url":
      return "That doesn't look like a link. In Instagram, tap Share on your post, then Copy link, and paste it here.";
    case "not_instagram":
      return "That link isn't from instagram.com. Paste the link to your Instagram post.";
    case "not_a_post":
      return "That isn't a link to a single post. It should have /p/, /reel/ or /tv/ in it.";
  }
}

/** Friendly copy for each username failure, shared by the form and the API. */
export function describeUsernameFailure(reason: UsernameFailure): string {
  switch (reason) {
    case "empty":
      return "Add your Instagram username.";
    case "invalid":
      return "That doesn't look like an Instagram username. Use letters, numbers, full stops and underscores (up to 30).";
  }
}

function matchKindAndShortcode(segments: string[]): { kind: PostKind; shortcode: string } | null {
  if (segments.length !== 2) return null;
  const kind = KIND_ALIASES.get(segments[0].toLowerCase());
  const shortcode = segments[1];
  if (!kind || !SHORTCODE_PATTERN.test(shortcode)) return null;
  return { kind, shortcode };
}

function linkFailure(reason: LinkFailure): LinkResult {
  return { ok: false, reason };
}
