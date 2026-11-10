import { describe, expect, it } from "vitest";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  layoutResultCard,
  renderResultCardJpeg,
  type CardLayout,
  type InkBox,
} from "@/lib/result-card";

type Rgb = readonly [number, number, number];

// The page's palette (app/globals.css).
const PAPER: Rgb = [0xff, 0xf4, 0xe0];
const WHITE: Rgb = [0xff, 0xff, 0xff];
const ACCENT: Rgb = [0xff, 0x3b, 0x6b];

const sample = { drawNumber: 12, dateLabel: "10 Nov 2026", winnerUsername: "lucky.duck", entryCount: 24 };

function pixel(layout: CardLayout, x: number, y: number): Rgb {
  const data = layout.canvas.getContext("2d").getImageData(Math.round(x), Math.round(y), 1, 1).data;
  return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
}

/** Largest difference on any channel. */
function colourDistance(actual: Rgb, expected: Rgb): number {
  return Math.max(...actual.map((channel, index) => Math.abs(channel - (expected[index] ?? 0))));
}

/** Share of dark (ink) pixels inside a box. */
function inkShare(layout: CardLayout, box: InkBox): number {
  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  const width = Math.min(CARD_WIDTH - x, Math.ceil(box.width));
  const height = Math.min(CARD_HEIGHT - y, Math.ceil(box.height));
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
