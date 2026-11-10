import "server-only";
import path from "node:path";
import { createCanvas, GlobalFonts, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";

// The result card a posting job can put on Instagram, drawn on request by
// /api/draws/{date}/card.jpg. It has the look of the page: cream paper with a
// dot grid, near-black ink, one pink accent, chunky bingo balls with white
// faces, thick outlines with a hard offset shadow, and the same typeface.
// The colours are the tokens in app/globals.css (--paper, --card, --ink,
// --muted, --accent). Change them together.

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;

const PAPER = "#fff4e0";
const WHITE = "#ffffff";
const INK = "#1a1410";
const MUTED = "#5e5248";
const ACCENT = "#ff3b6b";

const FONT_FAMILY = "Bricolage Grotesque";
// Google Fonts' variable Bricolage Grotesque (OFL: assets/fonts/OFL-BricolageGrotesque.txt).
// next.config.ts ships it with the card route (outputFileTracingIncludes).
const FONT_PATH = path.join(process.cwd(), "assets", "fonts", "BricolageGrotesque-Variable.ttf");
// The page loads this font without its optical-size axis, so every size there
// uses the default cut (14). Pin it, or large text gets narrower shapes.
const FONT_VARIATION = "'opsz' 14";

const MARGIN = 72;
/** Outline width: the page's 3px at this scale. */
const LINE = 8;
/** Offset of the hard shadow under cards and buttons. */
const SHADOW = 12;
const CONTENT_WIDTH = CARD_WIDTH - MARGIN * 2;

/** JPEG quality (0 to 100). Instagram only accepts JPEG. */
const JPEG_QUALITY = 92;

/** What the card shows. */
export interface ResultCardInput {
  drawNumber: number;
  /** As printed on the card, e.g. "10 Nov 2026". */
  dateLabel: string;
  /** Instagram username without "@". */
  winnerUsername: string;
  entryCount: number;
}

type Tone = "accent" | "paper" | "ink";

/** The five balls from the top of the page, B I N G O. */
const HERO_BALLS: ReadonlyArray<{ letter: string; number: string; tone: Tone; tilt: number; drop: number }> = [
  { letter: "B", number: "7", tone: "accent", tilt: -8, drop: 0 },
  { letter: "I", number: "23", tone: "paper", tilt: 6, drop: 20 },
  { letter: "N", number: "38", tone: "ink", tilt: -4, drop: 0 },
  { letter: "G", number: "52", tone: "accent", tilt: 9, drop: 16 },
  { letter: "O", number: "71", tone: "paper", tilt: -6, drop: 0 },
];

// Registered when this module loads, so a missing font file fails every request
// to the card route (including a 404 for a date with no draw). That shows up on
// the first request after a deploy, not on the first night with a winner.
if (!GlobalFonts.has(FONT_FAMILY) && !GlobalFonts.registerFromPath(FONT_PATH, FONT_FAMILY)) {
  throw new Error(`Could not load the ${FONT_FAMILY} font from ${FONT_PATH}`);
}

/** `tracking` is letter spacing in em, like CSS `letter-spacing`. */
function setFont(ctx: SKRSContext2D, weight: number, size: number, tracking = 0): void {
  ctx.font = `${weight} ${size}px "${FONT_FAMILY}"`;
  ctx.fontVariationSettings = FONT_VARIATION;
  ctx.letterSpacing = `${(tracking * size).toFixed(2)}px`;
}

/** Largest size at or below `start` at which `text` is no wider than `maxWidth`. */
function fitFont(
  ctx: SKRSContext2D,
  text: string,
  weight: number,
  start: number,
  maxWidth: number,
  tracking = 0,
): number {
  let size = start;
  setFont(ctx, weight, size, tracking);
  const natural = ctx.measureText(text).width;
  if (natural <= maxWidth) return size;
  size = Math.max(8, Math.floor((start * maxWidth) / natural));
  setFont(ctx, weight, size, tracking);
  while (size > 8 && ctx.measureText(text).width > maxWidth) {
    size -= 1;
    setFont(ctx, weight, size, tracking);
  }
  return size;
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

/** A filled, outlined box sitting on a hard offset shadow, like the page's cards and buttons. */
function raisedBox(
  ctx: SKRSContext2D,
  box: { x: number; y: number; width: number; height: number },
  radius: number,
  fill: string,
): void {
  ctx.fillStyle = INK;
  roundRect(ctx, box.x + SHADOW, box.y + SHADOW, box.width, box.height, radius);
  ctx.fill();
  ctx.fillStyle = fill;
  roundRect(ctx, box.x, box.y, box.width, box.height, radius);
  ctx.fill();
  ctx.lineWidth = LINE;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

function circle(ctx: SKRSContext2D, cx: number, cy: number, radius: number): void {
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.closePath();
}

/**
 * The page's bingo ball: a coloured shell with a shine, a white face, a number
 * and, on the big ones, a letter above it. Proportions follow `.ball` in the CSS.
 */
function drawBall(
  ctx: SKRSContext2D,
  cx: number,
  cy: number,
  diameter: number,
  tone: Tone,
  number: string,
  letter: string | null,
  tiltDegrees = 0,
): void {
  const radius = diameter / 2;
  const line = Math.max(3, diameter * 0.052);
  const shadow = diameter * 0.06;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((tiltDegrees * Math.PI) / 180);

  ctx.fillStyle = INK;
  circle(ctx, shadow, shadow, radius);
  ctx.fill();

  ctx.fillStyle = tone === "accent" ? ACCENT : tone === "ink" ? INK : PAPER;
  circle(ctx, 0, 0, radius - line / 2);
  ctx.fill();
  ctx.lineWidth = line;
  ctx.strokeStyle = INK;
  ctx.stroke();

  // The shine sits inside the outline, never on it.
  const inside = diameter - 2 * line;
  ctx.save();
  circle(ctx, 0, 0, radius - line);
  ctx.clip();
  ctx.fillStyle = tone === "ink" ? "rgba(255, 255, 255, 0.28)" : "rgba(255, 255, 255, 0.5)";
  ctx.beginPath();
  ctx.ellipse(-0.24 * inside, -0.325 * inside, 0.11 * inside, 0.075 * inside, (-35 * Math.PI) / 180, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = WHITE;
  circle(ctx, 0, 0, diameter * 0.33);
  ctx.fill();
  ctx.lineWidth = Math.max(2, diameter * 0.035);
  ctx.strokeStyle = INK;
  ctx.stroke();

  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  if (letter) {
    setFont(ctx, 800, diameter * 0.13, 0.04);
    ctx.fillText(letter, diameter * 0.003, -diameter * 0.115);
    setFont(ctx, 800, diameter * 0.3, -0.02);
    ctx.fillText(number, -diameter * 0.003, diameter * 0.165);
  } else {
    setFont(ctx, 800, diameter * 0.3, -0.02);
    ctx.fillText(number, 0, diameter * 0.105);
  }
  ctx.restore();
}

export interface InkBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CardLayout {
  canvas: Canvas;
  /** Ink of the "Draw #12 · 10 Nov 2026" label. */
  header: InkBox;
  /** Ink of the winner's @username. */
  username: InkBox;
  /** The white panel the username sits in. */
  panel: InkBox;
}

/** Ink bounds of left-aligned text drawn at `x` on `baseline` with the current font. */
function inkBox(ctx: SKRSContext2D, text: string, x: number, baseline: number): InkBox {
  const metrics = ctx.measureText(text);
  const ascent = metrics.actualBoundingBoxAscent || 0;
  const descent = metrics.actualBoundingBoxDescent || 0;
  const left = x - (metrics.actualBoundingBoxLeft || 0);
  const right = x + (metrics.actualBoundingBoxRight || metrics.width);
  return { x: left, y: baseline - ascent, width: Math.max(0, right - left), height: ascent + descent };
}

/** "repost.bingo" with the dot drawn as a small pink ball, as on the page. Returns its width. */
function drawWordmark(ctx: SKRSContext2D, x: number, baseline: number, maxWidth: number): number {
  const tracking = -0.045;
  const widthAt = (size: number) => {
    setFont(ctx, 800, size, tracking);
    return ctx.measureText("repost").width + ctx.measureText("bingo").width + 0.38 * size;
  };
  let size = 168;
  const natural = widthAt(size);
  if (natural > maxWidth) size = Math.floor((size * maxWidth) / natural);
  while (size > 8 && widthAt(size) > maxWidth) size -= 1;

  setFont(ctx, 800, size, tracking);
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("repost", x, baseline);
  const dotLeft = x + ctx.measureText("repost").width + 0.05 * size;
  const dotRadius = 0.14 * size;
  const dotLine = 0.05 * size;
  ctx.fillStyle = ACCENT;
  circle(ctx, dotLeft + dotRadius, baseline - dotRadius, dotRadius - dotLine / 2);
  ctx.fill();
  ctx.lineWidth = dotLine;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.fillText("bingo", dotLeft + 2 * dotRadius + 0.05 * size, baseline);
  return widthAt(size);
}

/** Draws the 1080×1350 card. Everything is drawn in code, so it needs no images. */
export function layoutResultCard(input: ResultCardInput): CardLayout {
  const canvas: Canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
  const ctx = canvas.getContext("2d");
  const winner = `@${input.winnerUsername.replace(/^@+/, "")}`;
  const header = `Draw #${input.drawNumber} · ${input.dateLabel}`;
  const entries = `picked from ${input.entryCount.toLocaleString("en-GB")} ${input.entryCount === 1 ? "entry" : "entries"}`;

  // Paper with a faint dot grid, like the page background.
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  ctx.fillStyle = "rgba(26, 20, 16, 0.08)";
  for (let y = 30; y < CARD_HEIGHT; y += 60) {
    for (let x = 30; x < CARD_WIDTH; x += 60) {
      circle(ctx, x, y, 3.2);
      ctx.fill();
    }
  }

  // The row of bingo balls from the top of the page.
  const ballSize = 150;
  const ballStep = ballSize + 20;
  HERO_BALLS.forEach((ball, index) => {
    drawBall(
      ctx,
      MARGIN + ballSize / 2 + index * ballStep,
      MARGIN + ballSize / 2 + 4 + ball.drop,
      ballSize,
      ball.tone,
      ball.number,
      ball.letter,
      ball.tilt,
    );
  });

  drawWordmark(ctx, MARGIN - 6, 404, CONTENT_WIDTH);

  // "Draw #12 · 10 Nov 2026" in a pink pill, like the page's "Tonight at 00:00" pill.
  const pill = { x: MARGIN, y: 468, height: 78, padding: 34 };
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  fitFont(ctx, header, 800, 40, CONTENT_WIDTH - pill.padding * 2);
  const headerWidth = ctx.measureText(header).width;
  ctx.fillStyle = ACCENT;
  roundRect(ctx, pill.x, pill.y, headerWidth + pill.padding * 2, pill.height, pill.height / 2);
  ctx.fill();
  ctx.lineWidth = LINE - 2;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = INK;
  const headerBaseline = pill.y + pill.height / 2 + 14;
  ctx.fillText(header, pill.x + pill.padding, headerBaseline);
  const headerBox = inkBox(ctx, header, pill.x + pill.padding, headerBaseline);

  // The winner, in a white card like the page's "Last night's winner" panel.
  const panel = { x: MARGIN, y: 598, width: CONTENT_WIDTH - SHADOW, height: 452 };
  raisedBox(ctx, panel, 52, WHITE);
  const inner = { x: panel.x + 56, width: panel.width - 112 };

  ctx.fillStyle = INK;
  setFont(ctx, 800, 34, 0.1);
  ctx.fillText("TODAY'S PICK", inner.x, panel.y + 100);

  // A short name is set large. A long one shrinks to fit and stays centred in the same band.
  const usernameSize = fitFont(ctx, winner, 800, 128, inner.width, -0.02);
  const usernameBaseline = panel.y + 222 + usernameSize * 0.35;
  const usernameBox = inkBox(ctx, winner, inner.x, usernameBaseline);
  // Pink underline, as on the page's winner link. Drawn first so descenders sit on top.
  const underline = Math.max(8, Math.round(usernameSize * 0.11));
  ctx.fillStyle = ACCENT;
  roundRect(
    ctx,
    usernameBox.x,
    usernameBaseline + Math.max(8, usernameSize * 0.13),
    usernameBox.width,
    underline,
    underline / 2,
  );
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.fillText(winner, inner.x, usernameBaseline);

  ctx.fillStyle = MUTED;
  fitFont(ctx, entries, 600, 40, inner.width);
  ctx.fillText(entries, inner.x, panel.y + 382);

  // Call to action, as a pink button.
  const button = { x: MARGIN, y: 1122, width: CONTENT_WIDTH - SHADOW, height: 108 };
  raisedBox(ctx, button, button.height / 2, ACCENT);
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  setFont(ctx, 800, 44);
  ctx.fillText("Submit yours, link in bio", button.x + button.width / 2, button.y + button.height / 2 + 15);

  return { canvas, header: headerBox, username: usernameBox, panel };
}

/** The card as a JPEG. Encoding runs off the main thread. */
export async function renderResultCardJpeg(input: ResultCardInput): Promise<Buffer> {
  return layoutResultCard(input).canvas.encode("jpeg", JPEG_QUALITY);
}
