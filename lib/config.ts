// Product settings in one place. Safe to import from client components.

export const SITE_NAME = "repost.bingo";
export const SITE_URL = "https://repost.bingo";

export const INSTAGRAM_HANDLE = "insta.repost.bingo";
export const INSTAGRAM_PROFILE_URL = `https://www.instagram.com/${INSTAGRAM_HANDLE}/`;

/**
 * The bot (a separate repo) runs the draw at 12:00 in this time zone. The site
 * only uses it to work out which date is "today" in the history list.
 */
export const DRAW_TIME_ZONE = "Europe/London";
export const DRAW_TIME_LABEL = "12:00";

/** Unpicked entries stay in the pool this long (the bot enforces it; the site shows the pool size). */
export const POOL_DAYS = 7;

/** How many past draws the history list loads. */
export const HISTORY_LIMIT = 30;

/** Basic per-IP limit on submit attempts (valid or not). */
export const SUBMIT_RATE_LIMIT = { limit: 10, windowMs: 10 * 60 * 1000 } as const;
