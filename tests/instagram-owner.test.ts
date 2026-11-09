import { describe, expect, it, vi } from "vitest";
import { buildPost } from "@/lib/instagram";
import { createOwnerLookup, ownerFromEmbedHtml, ownerFromPostPageHtml } from "@/lib/instagram-owner";

// Trimmed copies of the markup Instagram serves (structure as seen on real pages).
const embedHtml = (username: string) => `
<div class="Header"><a class="Avatar" href="https://www.instagram.com/${username}/?utm_source=ig_embed&amp;ig_rid=abc"><img alt="${username}" /></a>
<div class="HeaderText"><a class="Username" href="https://www.instagram.com/${username}/?utm_source=ig_embed&amp;ig_rid=abc" data-log-event="profileClick" target="_blank"><span class="UsernameText">${username}</span></a>
<div class="HeaderSecondaryContent"><span class="FollowerCountText">2 followers</span></div></div></div>
<div class="EmbeddedMedia"><img class="EmbeddedMediaImage" alt="" /></div>`;

const embedWithoutPost = `<div class="EmbedFrame"><p>This post may have been removed or isn't available.</p></div>`;

const postPageHtml = (ogUrl: string) => `
<head><meta property="instapp:owner_user_id" content="49247311507" />
<meta property="og:url" content="${ogUrl}" />
<meta property="og:description" content="1 likes, 0 comments - slashie.app on November 9, 2026" /></head>`;

const post = buildPost("p", "DfiOsp6t354");

function htmlResponse(html: string, { status = 200, url = "https://www.instagram.com/p/DfiOsp6t354/embed/" } = {}) {
  const response = new Response(html, { status, headers: { "content-type": "text/html" } });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

describe("ownerFromEmbedHtml", () => {
  it("reads the owner from the embed header", () => {
    expect(ownerFromEmbedHtml(embedHtml("slashie.app"))).toBe("slashie.app");
    expect(ownerFromEmbedHtml(embedHtml("Some_Creator"))).toBe("some_creator");
  });

  it("falls back to the profile link when the name span is missing", () => {
    const html = `<a class="Username" href="https://www.instagram.com/slashie.app/?utm_source=ig_embed&amp;ig_rid=x">`;
    expect(ownerFromEmbedHtml(html)).toBe("slashie.app");
  });

  it("finds no owner on an embed for a missing or private post", () => {
    expect(ownerFromEmbedHtml(embedWithoutPost)).toBeNull();
    expect(ownerFromEmbedHtml("")).toBeNull();
  });

  it("ignores values that aren't valid usernames", () => {
    expect(ownerFromEmbedHtml(`<span class="UsernameText">not a username</span>`)).toBeNull();
  });
});

describe("ownerFromPostPageHtml", () => {
  it("reads the owner from og:url when the shortcode matches", () => {
    expect(ownerFromPostPageHtml(postPageHtml("https://www.instagram.com/slashie.app/p/DfiOsp6t354/"), "DfiOsp6t354")).toBe(
      "slashie.app",
    );
    expect(ownerFromPostPageHtml(postPageHtml("https://www.instagram.com/someone/reel/fA9uwTtkSN/"), "fA9uwTtkSN")).toBe(
      "someone",
    );
  });

  it("rejects an og:url for a different post or without an owner", () => {
    expect(ownerFromPostPageHtml(postPageHtml("https://www.instagram.com/slashie.app/p/OtherPost1/"), "DfiOsp6t354")).toBeNull();
    expect(ownerFromPostPageHtml(postPageHtml("https://www.instagram.com/p/DfiOsp6t354/"), "DfiOsp6t354")).toBeNull();
    expect(ownerFromPostPageHtml("<html>login</html>", "DfiOsp6t354")).toBeNull();
  });
});

describe("createOwnerLookup", () => {
  it("asks the embed page first and returns its owner", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => htmlResponse(embedHtml("slashie.app")));
    await expect(createOwnerLookup(fetchImpl)(post)).resolves.toEqual({ ok: true, username: "slashie.app" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toBe("https://www.instagram.com/p/DfiOsp6t354/embed/");
  });

  it("treats an embed without an owner as a missing or private post", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => htmlResponse(embedWithoutPost));
    await expect(createOwnerLookup(fetchImpl)(post)).resolves.toEqual({ ok: false, reason: "not_public" });
  });

  it("treats a 404 as a missing post", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => htmlResponse("", { status: 404 }));
    await expect(createOwnerLookup(fetchImpl)(post)).resolves.toEqual({ ok: false, reason: "not_public" });
  });

  it("falls back to the post page when the embed is rate-limited", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) =>
      String(input).endsWith("/embed/")
        ? htmlResponse("", { status: 429 })
        : htmlResponse(postPageHtml("https://www.instagram.com/slashie.app/p/DfiOsp6t354/"), {
            url: "https://www.instagram.com/p/DfiOsp6t354/",
          }),
    );
    await expect(createOwnerLookup(fetchImpl)(post)).resolves.toEqual({ ok: true, username: "slashie.app" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("reports Instagram as unavailable when both pages are blocked", async () => {
    const loginWall = vi.fn<typeof fetch>(async () =>
      htmlResponse("<html>Log in</html>", { url: "https://www.instagram.com/accounts/login/?next=%2Fp%2FDfiOsp6t354%2F" }),
    );
    await expect(createOwnerLookup(loginWall)(post)).resolves.toEqual({ ok: false, reason: "unavailable" });

    const rateLimited = vi.fn<typeof fetch>(async () => htmlResponse("", { status: 429 }));
    await expect(createOwnerLookup(rateLimited)(post)).resolves.toEqual({ ok: false, reason: "unavailable" });

    const offline = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(createOwnerLookup(offline)(post)).resolves.toEqual({ ok: false, reason: "unavailable" });
  });

  it("doesn't call a login-walled post page 'not public'", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) =>
      String(input).endsWith("/embed/")
        ? htmlResponse("", { status: 429 })
        : htmlResponse("<html>Instagram</html>", { url: "https://www.instagram.com/p/DfiOsp6t354/" }),
    );
    await expect(createOwnerLookup(fetchImpl)(post)).resolves.toEqual({ ok: false, reason: "unavailable" });
  });
});
