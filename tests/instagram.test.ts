import { describe, expect, it } from "vitest";
import {
  MAX_LINK_LENGTH,
  describeLinkFailure,
  describeUsernameFailure,
  parseInstagramPostUrl,
  parseInstagramUsername,
  postUrlVariants,
  type LinkFailure,
  type PostKind,
} from "@/lib/instagram";

function normalise(input: string) {
  const result = parseInstagramPostUrl(input);
  if (!result.ok) throw new Error(`Expected ${input} to be valid, got ${result.reason}`);
  return result.post;
}

describe("link validation: accepted links", () => {
  it.each<[string, PostKind, string]>([
    ["https://www.instagram.com/p/DAbc123xYz_/", "p", "DAbc123xYz_"],
    ["https://www.instagram.com/reel/C9-kL2mNoPq/", "reel", "C9-kL2mNoPq"],
    ["https://www.instagram.com/tv/B7xYz12AbCd/", "tv", "B7xYz12AbCd"],
    ["https://www.instagram.com/reels/C9-kL2mNoPq/", "reel", "C9-kL2mNoPq"],
    ["https://instagram.com/p/DAbc123xYz_", "p", "DAbc123xYz_"],
    ["https://m.instagram.com/p/DAbc123xYz_/", "p", "DAbc123xYz_"],
    ["http://www.instagram.com/p/DAbc123xYz_/", "p", "DAbc123xYz_"],
    ["www.instagram.com/p/DAbc123xYz_/", "p", "DAbc123xYz_"],
    ["instagram.com/reel/C9-kL2mNoPq", "reel", "C9-kL2mNoPq"],
    ["https://www.instagram.com/p/fA9uwTtkSN/", "p", "fA9uwTtkSN"],
    ["https://www.instagram.com:443/p/DAbc123xYz_/", "p", "DAbc123xYz_"],
    // Newer share links put the username before the post type.
    ["https://www.instagram.com/some.creator/p/DAbc123xYz_/", "p", "DAbc123xYz_"],
    ["https://www.instagram.com/Some_Creator/reel/C9-kL2mNoPq/", "reel", "C9-kL2mNoPq"],
  ])("accepts %s", (input, kind, shortcode) => {
    const post = normalise(input);
    expect(post.kind).toBe(kind);
    expect(post.shortcode).toBe(shortcode);
  });
});

describe("link validation: rejected links", () => {
  it.each<[unknown, LinkFailure]>([
    ["", "empty"],
    ["   ", "empty"],
    [undefined, "empty"],
    [null, "empty"],
    [42, "empty"],
    [{ url: "https://www.instagram.com/p/DAbc123xYz_/" }, "empty"],
    ["not a link", "not_a_url"],
    ["https://", "not_a_url"],
    ["https://www.instagram.com/p/DAbc 123/", "not_a_url"],
    ["ftp://www.instagram.com/p/DAbc123xYz_/", "not_a_url"],
    ["javascript:alert(1)", "not_a_url"],
    ["mailto:hello@example.com", "not_a_url"],
    ["https://instagram.com.evil.example/p/DAbc123xYz_/", "not_instagram"],
    ["https://evilinstagram.com/p/DAbc123xYz_/", "not_instagram"],
    ["https://instagr.am/p/DAbc123xYz_/", "not_instagram"],
    ["https://www.threads.net/@someone/post/DAbc123xYz_", "not_instagram"],
    ["https://www.facebook.com/p/DAbc123xYz_/", "not_instagram"],
    ["https://user:pass@www.instagram.com/p/DAbc123xYz_/", "not_instagram"],
    ["https://www.instagram.com:8443/p/DAbc123xYz_/", "not_instagram"],
    ["https://www.instagram.com/", "not_a_post"],
    ["https://www.instagram.com/some.creator/", "not_a_post"],
    ["https://www.instagram.com/stories/some.creator/3456789012345678901/", "not_a_post"],
    ["https://www.instagram.com/explore/tags/bingo/", "not_a_post"],
    ["https://www.instagram.com/p/", "not_a_post"],
    ["https://www.instagram.com/p/DAbc123xYz_/embed/", "not_a_post"],
    ["https://www.instagram.com/p/bad$code/", "not_a_post"],
    ["https://www.instagram.com/p/%41bc123/", "not_a_post"],
    ["https://www.instagram.com/x/DAbc123xYz_/", "not_a_post"],
    ["https://www.instagram.com/constructor/DAbc123xYz_/", "not_a_post"],
    [`https://www.instagram.com/p/${"A".repeat(65)}/`, "not_a_post"],
  ])("rejects %j as %s", (input, reason) => {
    expect(parseInstagramPostUrl(input)).toEqual({ ok: false, reason });
  });

  it("rejects input longer than the maximum link length", () => {
    const input = `https://www.instagram.com/p/DAbc123xYz_/?pad=${"a".repeat(MAX_LINK_LENGTH)}`;
    expect(parseInstagramPostUrl(input)).toEqual({ ok: false, reason: "too_long" });
  });
});

describe("link normalisation", () => {
  it.each<[string, string]>([
    // Strips the query string and the trailing slash.
    [
      "https://www.instagram.com/p/DAbc123xYz_/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==",
      "https://www.instagram.com/p/DAbc123xYz_",
    ],
    ["https://www.instagram.com/reel/C9-kL2mNoPq/?igsh=abc", "https://www.instagram.com/reel/C9-kL2mNoPq"],
    // Strips a #fragment.
    ["https://www.instagram.com/p/DAbc123xYz_/#comments", "https://www.instagram.com/p/DAbc123xYz_"],
    // Lowercases the host (and the post type), keeps the shortcode as it is.
    ["HTTPS://WWW.INSTAGRAM.COM/P/DAbc123xYz_/", "https://www.instagram.com/p/DAbc123xYz_"],
    // One host and scheme, so the same post can't go in twice via instagram.com vs www./m.
    ["http://instagram.com/p/DAbc123xYz_", "https://www.instagram.com/p/DAbc123xYz_"],
    ["https://m.instagram.com/tv/B7xYz12AbCd/", "https://www.instagram.com/tv/B7xYz12AbCd"],
    ["instagram.com/p/DAbc123xYz_", "https://www.instagram.com/p/DAbc123xYz_"],
    // Drops the username prefix and spells /reels/ as /reel/.
    ["https://www.instagram.com/some.creator/p/DAbc123xYz_/", "https://www.instagram.com/p/DAbc123xYz_"],
    ["https://www.instagram.com/reels/C9-kL2mNoPq/", "https://www.instagram.com/reel/C9-kL2mNoPq"],
    // Trims whitespace around a pasted link.
    ["  https://www.instagram.com/p/DAbc123xYz_/ \n", "https://www.instagram.com/p/DAbc123xYz_"],
    // A real link from Instagram's web share sheet.
    [
      "https://www.instagram.com/p/DfiOsp6t354/?utm_source=ig_web_button_share_sheet&rpxt=MzRlODBiNWFlZA==",
      "https://www.instagram.com/p/DfiOsp6t354",
    ],
  ])("%s -> %s", (input, expected) => {
    expect(normalise(input).url).toBe(expected);
  });

  it("keeps the post type, so reels stay reels", () => {
    expect(normalise("https://www.instagram.com/reel/C9-kL2mNoPq/").url).toBe(
      "https://www.instagram.com/reel/C9-kL2mNoPq",
    );
    expect(normalise("https://www.instagram.com/p/C9-kL2mNoPq/").url).toBe(
      "https://www.instagram.com/p/C9-kL2mNoPq",
    );
  });

  it("keeps shortcode case, because Instagram shortcodes are case-sensitive", () => {
    expect(normalise("https://www.instagram.com/p/AbCdEfGhIjK/").url).not.toBe(
      normalise("https://www.instagram.com/p/abcdefghijk/").url,
    );
  });

  it("is idempotent", () => {
    const once = normalise("https://m.instagram.com/someone/reels/C9-kL2mNoPq/?igsh=1#x").url;
    expect(normalise(once).url).toBe(once);
  });

  it("lists every link the same post could have been entered under", () => {
    expect(postUrlVariants("C9-kL2mNoPq")).toEqual([
      "https://www.instagram.com/p/C9-kL2mNoPq",
      "https://www.instagram.com/reel/C9-kL2mNoPq",
      "https://www.instagram.com/tv/C9-kL2mNoPq",
    ]);
  });
});

describe("username validation", () => {
  it.each<[string, string]>([
    ["someone", "someone"],
    ["@someone", "someone"],
    ["slashie.app", "slashie.app"],
    ["  @Some.One_99  ", "some.one_99"],
    ["SOMEONE", "someone"],
    ["a", "a"],
    ["x".repeat(30), "x".repeat(30)],
    ["https://www.instagram.com/some.one/", "some.one"],
    ["instagram.com/some_one?igsh=abc", "some_one"],
  ])("accepts %j as %j", (input, username) => {
    expect(parseInstagramUsername(input)).toEqual({ ok: true, username });
  });

  it.each<[unknown, "empty" | "invalid"]>([
    ["", "empty"],
    ["   ", "empty"],
    ["@", "empty"],
    [undefined, "empty"],
    [7, "empty"],
    ["x".repeat(31), "invalid"],
    ["some one", "invalid"],
    ["some-one", "invalid"],
    ["some!one", "invalid"],
    [".someone", "invalid"],
    ["someone.", "invalid"],
    ["some..one", "invalid"],
    ["@@someone", "invalid"],
    ["https://www.instagram.com/p/DAbc123xYz_/", "invalid"],
    ["<script>", "invalid"],
  ])("rejects %j as %s", (input, reason) => {
    expect(parseInstagramUsername(input)).toEqual({ ok: false, reason });
  });
});

describe("error copy", () => {
  it.each<LinkFailure>(["empty", "too_long", "not_a_url", "not_instagram", "not_a_post"])(
    "has friendly copy for link failure %s",
    (reason) => {
      expect(describeLinkFailure(reason)).toMatch(/\.$/);
    },
  );

  it.each(["empty", "invalid"] as const)("has friendly copy for username failure %s", (reason) => {
    expect(describeUsernameFailure(reason)).toMatch(/\.$/);
  });
});
