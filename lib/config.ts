// Product settings in one place. Safe to import from client components.

export const SITE_NAME = "repost.bingo";
export const SITE_URL = "https://repost.bingo";

export const INSTAGRAM_HANDLE = "insta.repost.bingo";
export const INSTAGRAM_PROFILE_URL = `https://www.instagram.com/${INSTAGRAM_HANDLE}/`;

/**
 * The bot (a separate repo) runs the draw every night at 00:00 in this time
 * zone. The site uses it for "today" in the history and for the countdown.
 */
export const DRAW_TIME_ZONE = "Europe/London";
export const DRAW_TIME_LABEL = "00:00";

/** Unpicked entries stay in the pool this long (the bot enforces it; the site shows the pool size). */
export const POOL_DAYS = 7;

/** How many past draws the history list loads. */
export const HISTORY_LIMIT = 30;

/** How many entrants the "Who's in" list shows (newest first). */
export const POOL_LIST_LIMIT = 100;

/** Basic per-IP limit on submit attempts (valid or not). */
export const SUBMIT_RATE_LIMIT = { limit: 10, windowMs: 10 * 60 * 1000 } as const;

/**
 * Per-IP limit on drawing result images. The card and the story share one
 * bucket. Vercel's CDN serves repeat requests, so this only counts renders:
 * it stops a script from burning CPU by adding junk query strings to the URL.
 */
export const CARD_RATE_LIMIT = { limit: 30, windowMs: 10 * 60 * 1000 } as const;
