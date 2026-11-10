import { describe, expect, it } from "vitest";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  EMPTY_STORY_HOOK,
  STORY_HEIGHT,
  STORY_HOOKS,
  STORY_REASSURANCE,
  STORY_SAFE_INSET,
  STORY_STEPS,
  STORY_WIDTH,
  layoutResultCard,
  layoutResultStory,
  renderResultCardJpeg,
  renderResultStoryJpeg,
  storyHook,
  type CardLayout,
  type InkBox,
  type StoryLayout,
} from "@/lib/result-card";

type Rgb = readonly [number, number, number];

// The page's palette (app/globals.css).
const PAPER: Rgb = [0xff, 0xf4, 0xe0];
const WHITE: Rgb = [0xff, 0xff, 0xff];
const ACCENT: Rgb = [0xff, 0x3b, 0x6b];

const sample = { drawNumber: 12, dateLabel: "10 Nov 2026", winnerUsername: "lucky.duck", entryCount: 24 };

function pixel(layout: { canvas: CardLayout["canvas"] }, x: number, y: number): Rgb {
  const data = layout.canvas.getContext("2d").getImageData(Math.round(x), Math.round(y), 1, 1).data;
  return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
}

/** Largest difference on any channel. */
function colourDistance(actual: Rgb, expected: Rgb): number {
  return Math.max(...actual.map((channel, index) => Math.abs(channel - (expected[index] ?? 0))));
}

/** Share of dark (ink) pixels inside a box. */
function inkShare(layout: { canvas: CardLayout["canvas"] }, box: InkBox): number {
  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  const width = Math.min(layout.canvas.width - x, Math.ceil(box.width));
  const height = Math.min(layout.canvas.height - y, Math.ceil(box.height));
  const data = layout.canvas.getContext("2d").getImageData(x, y, width, height).data;
  let dark = 0;
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i] ?? 255) < 70 && (data[i + 1] ?? 255) < 70 && (data[i + 2] ?? 255) < 70) dark += 1;
  }
  return dark / (width * height);
}

/** Width and height from a baseline JPEG's SOF0 marker. */
function jpegSize(jpeg: Uint8Array): { width: number; height: number } {
  const view = new DataView(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength);
  let offset = 2;
  while (offset < jpeg.length) {
    const marker = view.getUint16(offset);
    const length = view.getUint16(offset + 2);
    if (marker === 0xffc0 || marker === 0xffc2) {
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    }
    offset += 2 + length;
  }
  throw new Error("No frame header in JPEG");
}

describe("result card", () => {
  it("is a 1080x1350 JPEG, Instagram's portrait size", async () => {
    const jpeg = await renderResultCardJpeg(sample);
    expect([jpeg[0], jpeg[1], jpeg[2]]).toEqual([0xff, 0xd8, 0xff]);
    expect(jpegSize(jpeg)).toEqual({ width: 1080, height: 1350 });
    expect(CARD_WIDTH).toBe(1080);
    expect(CARD_HEIGHT).toBe(1350);
    expect(jpeg.length).toBeGreaterThan(20_000);
  });

  it("uses the page's palette: cream paper, a white panel, pink accents and dark ink", () => {
    const layout = layoutResultCard(sample);
    const { panel, header, username } = layout;
    expect(colourDistance(pixel(layout, 2, 2), PAPER)).toBeLessThanOrEqual(4);
    expect(colourDistance(pixel(layout, panel.x + panel.width - 60, panel.y + 40), WHITE)).toBeLessThanOrEqual(4);
    // The draw label sits in a pink pill.
    expect(colourDistance(pixel(layout, header.x - 14, header.y + header.height / 2), ACCENT)).toBeLessThanOrEqual(4);
    // The username and the draw label are drawn in ink.
    expect(inkShare(layout, username)).toBeGreaterThan(0.2);
    expect(inkShare(layout, header)).toBeGreaterThan(0.2);
  });

  it("keeps the draw label and a 30-character username inside the card and the panel", () => {
    const cases = [
      sample,
      { drawNumber: 1284, dateLabel: "30 Sept 2026", winnerUsername: "a".repeat(30), entryCount: 9999 },
      { drawNumber: 99999, dateLabel: "30 September 2026", winnerUsername: "w".repeat(30), entryCount: 1 },
    ];
    for (const input of cases) {
      const { header, username, panel } = layoutResultCard(input);
      expect(header.width).toBeGreaterThan(0);
      expect(username.width).toBeGreaterThan(0);
      expect(header.x).toBeGreaterThanOrEqual(72);
      expect(header.x + header.width).toBeLessThanOrEqual(CARD_WIDTH - 72);
      expect(username.x).toBeGreaterThanOrEqual(panel.x + 40);
      expect(username.x + username.width).toBeLessThanOrEqual(panel.x + panel.width - 40);
      expect(username.y).toBeGreaterThanOrEqual(panel.y + 110);
      expect(username.y + username.height).toBeLessThanOrEqual(panel.y + panel.height - 110);
    }
  });

  it("sets a short name large and shrinks a long one to fit", () => {
    const short = layoutResultCard({ ...sample, winnerUsername: "jo" });
    const long = layoutResultCard({ ...sample, winnerUsername: "a_very.long_username.thirty_ch" });
    expect(short.username.height).toBeGreaterThan(long.username.height * 1.5);
    expect(long.username.width).toBeGreaterThan(short.username.width * 2);
  });
});

const storySample = { drawNumber: 1, dateLabel: "10 Nov 2026", winnerUsername: "slashie.app", entryCount: 6 };

function hookPixels(layout: StoryLayout): number[] {
  const box = layout.hook;
  const data = layout.canvas
    .getContext("2d")
    .getImageData(Math.round(box.x), Math.round(box.y), Math.max(1, Math.round(box.width)), Math.max(1, Math.round(box.height)))
    .data;
  return [...data];
}

describe("result story", () => {
  it("rotates the hook by draw number, and an empty night uses the first-entry line", () => {
    expect(STORY_HOOKS).toEqual([
      "Your post could be next",
      "Free exposure, every night",
      "One post. One repost. Every day.",
      "Tonight could be yours",
    ]);
    expect(storyHook(1)).toBe("Your post could be next");
    expect(storyHook(2)).toBe("Free exposure, every night");
    expect(storyHook(3)).toBe("One post. One repost. Every day.");
    expect(storyHook(4)).toBe("Tonight could be yours");
    expect(storyHook(5)).toBe(storyHook(1));
    expect(STORY_STEPS).toEqual([
      "Follow @insta.repost.bingo",
      "Submit your post at instagram.repost.bingo",
      "Picked daily at midnight",
    ]);
    expect(STORY_REASSURANCE).toBe("Free, credited");
    expect(EMPTY_STORY_HOOK).toBe("No entries yet - be the first to get picked");
  });

  it("is a 1080x1920 JPEG", async () => {
    const jpeg = await renderResultStoryJpeg(storySample);
    expect([jpeg[0], jpeg[1], jpeg[2]]).toEqual([0xff, 0xd8, 0xff]);
    expect(jpegSize(jpeg)).toEqual({ width: 1080, height: 1920 });
    expect(STORY_WIDTH).toBe(1080);
    expect(STORY_HEIGHT).toBe(1920);
    expect(jpeg.length).toBeGreaterThan(20_000);
  });

  it("keeps the pitch, the winner and the steps inside the story safe zone", () => {
    const cases = [
      storySample,
      { drawNumber: 3, dateLabel: "30 Sept 2026", winnerUsername: "w".repeat(30), entryCount: 9999 },
      { drawNumber: 12, dateLabel: "10 Nov 2026", winnerUsername: "your.username", entryCount: 24 },
      { drawNumber: 4, dateLabel: "11 Nov 2026", winnerUsername: null, entryCount: 0 },
    ];
    for (const input of cases) {
      const layout = layoutResultStory(input);
      expect(layout.hookText).toBe(input.winnerUsername ? storyHook(input.drawNumber) : EMPTY_STORY_HOOK);
      expect(layout.blocks.length).toBeGreaterThanOrEqual(6);
      for (const box of layout.blocks) {
        expect(box.width).toBeGreaterThan(0);
        expect(box.height).toBeGreaterThan(0);
        expect(box.x).toBeGreaterThanOrEqual(48);
        expect(box.x + box.width).toBeLessThanOrEqual(STORY_WIDTH - 48);
        expect(box.y).toBeGreaterThanOrEqual(STORY_SAFE_INSET);
        expect(box.y + box.height).toBeLessThanOrEqual(STORY_HEIGHT - STORY_SAFE_INSET);
      }
      expect(inkShare(layout, layout.hook)).toBeGreaterThan(0.08);
      if (input.winnerUsername) {
        expect(layout.username).not.toBeNull();
        expect(layout.panel).not.toBeNull();
        const username = layout.username!;
        const panel = layout.panel!;
        expect(username.x).toBeGreaterThanOrEqual(panel.x + 40);
        expect(username.x + username.width).toBeLessThanOrEqual(panel.x + panel.width - 40);
        expect(username.y).toBeGreaterThanOrEqual(panel.y + 40);
        expect(username.y + username.height).toBeLessThanOrEqual(panel.y + panel.height - 40);
      } else {
        expect(layout.username).toBeNull();
        expect(layout.panel).toBeNull();
      }
    }
  });

  it("paints a different hook for the next draw number, and the same hook four draws later", () => {
    const first = layoutResultStory(storySample);
    const next = layoutResultStory({ ...storySample, drawNumber: 2 });
    const later = layoutResultStory({ ...storySample, drawNumber: 5 });
    expect(first.hookText).not.toBe(next.hookText);
    expect(hookPixels(first)).not.toEqual(hookPixels(next));
    expect(first.hookText).toBe(later.hookText);
    expect(hookPixels(first)).toEqual(hookPixels(later));
  });

  it("uses the page's palette", () => {
    const layout = layoutResultStory(storySample);
    const panel = layout.panel!;
    expect(colourDistance(pixel(layout, 2, 2), PAPER)).toBeLessThanOrEqual(4);
    expect(colourDistance(pixel(layout, 2, STORY_HEIGHT - 2), PAPER)).toBeLessThanOrEqual(4);
    expect(colourDistance(pixel(layout, panel.x + 36, panel.y + 28), WHITE)).toBeLessThanOrEqual(4);
    const button = layout.blocks[layout.blocks.length - 1]!;
    expect(colourDistance(pixel(layout, button.x + 48, button.y + 36), ACCENT)).toBeLessThanOrEqual(4);
    // The unsafe bands are paper (and the dot grid), not type or panels.
    expect(colourDistance(pixel(layout, 540, 80), PAPER)).toBeLessThanOrEqual(4);
    expect(colourDistance(pixel(layout, 540, STORY_HEIGHT - 80), PAPER)).toBeLessThanOrEqual(4);
  });
});
