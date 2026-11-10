import "server-only";
import path from "node:path";
import { createCanvas, GlobalFonts, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import { INSTAGRAM_HANDLE } from "./config";

// Result images a posting job can hand to Instagram, drawn on request:
// /api/draws/{date}/card.jpg (1080×1350) and story.jpg (1080×1920). They have
// the look of the page: cream paper with a dot grid, near-black ink, one pink
// accent, chunky bingo balls with white faces, thick outlines with a hard
// offset shadow, and the same typeface. The colours are the tokens in
// app/globals.css (--paper, --card, --ink, --muted, --accent). Change them together.

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

/** Cream paper and the page's faint dot grid. */
function paintPaper(ctx: SKRSContext2D, width: number, height: number): void {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgba(26, 20, 16, 0.08)";
  for (let y = 30; y < height; y += 60) {
    for (let x = 30; x < width; x += 60) {
      circle(ctx, x, y, 3.2);
      ctx.fill();
    }
  }
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

const WORDMARK_TRACKING = -0.045;

function wordmarkWidth(ctx: SKRSContext2D, size: number): number {
  setFont(ctx, 800, size, WORDMARK_TRACKING);
  return ctx.measureText("repost").width + ctx.measureText("bingo").width + 0.38 * size;
}

/** "repost.bingo" with the dot drawn as a small pink ball, as on the page. Returns its width. */
function drawWordmark(
  ctx: SKRSContext2D,
  x: number,
  baseline: number,
  maxWidth: number,
  maxSize = 168,
): number {
  let size = maxSize;
  const natural = wordmarkWidth(ctx, size);
  if (natural > maxWidth) size = Math.floor((size * maxWidth) / natural);
  while (size > 8 && wordmarkWidth(ctx, size) > maxWidth) size -= 1;

  setFont(ctx, 800, size, WORDMARK_TRACKING);
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
  return wordmarkWidth(ctx, size);
}

/** Draws the 1080×1350 card. Everything is drawn in code, so it needs no images. */
export function layoutResultCard(input: ResultCardInput): CardLayout {
  const canvas: Canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
  const ctx = canvas.getContext("2d");
  const winner = `@${input.winnerUsername.replace(/^@+/, "")}`;
  const header = `Draw #${input.drawNumber} · ${input.dateLabel}`;
  const entries = `picked from ${input.entryCount.toLocaleString("en-GB")} ${input.entryCount === 1 ? "entry" : "entries"}`;

  paintPaper(ctx, CARD_WIDTH, CARD_HEIGHT);

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

// --- Story (1080×1920) -------------------------------------------------------
// A pitch, not only a result. The hook is the largest type. The winner, the
// draw number and the date stay. Everything important sits inside the story
// safe zone: Instagram covers about 250px at the top and the bottom.

export const STORY_WIDTH = 1080;
export const STORY_HEIGHT = 1920;
export const STORY_SAFE_INSET = 250;

const STORY_MARGIN = 72;
const STORY_CONTENT = STORY_WIDTH - STORY_MARGIN * 2;

/** Honest lines, in draw-number order. Draw 1 uses the first. No follower counts. */
export const STORY_HOOKS = [
  "Your post could be next",
  "Free exposure, every night",
  "One post. One repost. Every day.",
  "Tonight could be yours",
] as const;

export const EMPTY_STORY_HOOK = "No entries yet - be the first to get picked";

export const STORY_STEPS = [
  `Follow @${INSTAGRAM_HANDLE}`,
  "Submit your post at instagram.repost.bingo",
  "Picked daily at midnight",
] as const;

export const STORY_REASSURANCE = "Free, credited";

const HOOK_TRACKING = -0.03;
const HOOK_MAX = 92;
const HOOK_MIN = 60;
const STORY_BALL = 120;
const WORDMARK_MAX = 72;
const PILL_H = 72;
const PANEL_H = 288;
const BUTTON_H = 96;
const STEP_BALL = 58;
const STEP_PITCH = 84;

/** Draw 1 uses the first line, draw 2 the second, then it repeats. */
export function storyHook(drawNumber: number): string {
  const index = (drawNumber - 1) % STORY_HOOKS.length;
  return STORY_HOOKS[index] ?? STORY_HOOKS[0];
}

export interface StoryCardInput {
  drawNumber: number;
  /** As printed, e.g. "10 Nov 2026". */
  dateLabel: string;
  /** Instagram username without "@". Null when the night had no entries. */
  winnerUsername: string | null;
  entryCount: number;
}

export interface StoryLayout {
  canvas: Canvas;
  hookText: string;
  /** Painted shapes and text that have to stay inside the safe zone. */
  blocks: InkBox[];
  hook: InkBox;
  username: InkBox | null;
  panel: InkBox | null;
}

interface HookMeasure {
  size: number;
  lines: string[];
  ascent: number;
  descent: number;
  lineHeight: number;
  underline: number;
  underlineGap: number;
  height: number;
}

function hookLinesAt(ctx: SKRSContext2D, text: string, size: number, maxWidth: number): string[] | null {
  setFont(ctx, 800, size, HOOK_TRACKING);
  const width = (line: string) => ctx.measureText(line).width;
  if (width(text) <= maxWidth) return [text];
  const words = text.split(" ");
  let best: { lines: string[]; score: number } | null = null;
  for (let i = 1; i < words.length; i++) {
    const lines = [words.slice(0, i).join(" "), words.slice(i).join(" ")];
    const widths = lines.map(width);
    if (widths.some((w) => w > maxWidth)) continue;
    // Prefer a break after a dash or a full stop when the lengths are close.
    const previous = words[i - 1] ?? "";
    const bias = previous === "-" || previous.endsWith(".") ? maxWidth * 0.12 : 0;
    const score = Math.abs((widths[0] ?? 0) - (widths[1] ?? 0)) - bias;
    if (!best || score < best.score) best = { lines, score };
  }
  return best?.lines ?? null;
}

function measureHook(ctx: SKRSContext2D, text: string, maxWidth: number): HookMeasure {
  let size = HOOK_MAX;
  let lines = hookLinesAt(ctx, text, size, maxWidth);
  while (size > HOOK_MIN && !lines) {
    size -= 2;
    lines = hookLinesAt(ctx, text, size, maxWidth);
  }
  const drawn = lines ?? [text];
  setFont(ctx, 800, size, HOOK_TRACKING);
  let ascent = 0;
  let descent = 0;
  for (const line of drawn) {
    const metrics = ctx.measureText(line);
    ascent = Math.max(ascent, metrics.actualBoundingBoxAscent);
    descent = Math.max(descent, metrics.actualBoundingBoxDescent);
  }
  const leading = Math.round(size * 0.16);
  const lineHeight = ascent + descent + leading;
  const underline = Math.max(10, Math.round(size * 0.1));
  const underlineGap = Math.round(size * 0.14);
  const height = drawn.length * lineHeight - leading + underlineGap + underline;
  return { size, lines: drawn, ascent, descent, lineHeight, underline, underlineGap, height };
}

function ballsBlock(): { height: number; rowWidth: number; left: number; drops: number[] } {
  const scale = STORY_BALL / 150;
  const drops = HERO_BALLS.map((ball) => ball.drop * scale);
  const gap = 16;
  const rowWidth = HERO_BALLS.length * STORY_BALL + (HERO_BALLS.length - 1) * gap;
  const shadow = STORY_BALL * 0.06;
  return {
    height: STORY_BALL + Math.max(...drops) + shadow,
    rowWidth,
    left: (STORY_WIDTH - rowWidth) / 2,
    drops,
  };
}

function drawBalls(ctx: SKRSContext2D, y: number): InkBox {
  const block = ballsBlock();
  const shadow = STORY_BALL * 0.06;
  HERO_BALLS.forEach((ball, index) => {
    drawBall(
      ctx,
      block.left + STORY_BALL / 2 + index * (STORY_BALL + 16),
      y + STORY_BALL / 2 + (block.drops[index] ?? 0),
      STORY_BALL,
      ball.tone,
      ball.number,
      ball.letter,
      ball.tilt,
    );
  });
  return { x: block.left, y, width: block.rowWidth + shadow, height: block.height };
}

function measureWordmarkBlock(ctx: SKRSContext2D): { size: number; width: number; height: number; ascent: number } {
  let size = WORDMARK_MAX;
  let width = wordmarkWidth(ctx, size);
  if (width > STORY_CONTENT) size = Math.max(8, Math.floor((size * STORY_CONTENT) / width));
  while (size > 8 && wordmarkWidth(ctx, size) > STORY_CONTENT) size -= 1;
  width = wordmarkWidth(ctx, size);
  const metrics = ctx.measureText("bingo");
  const ascent = Math.max(metrics.actualBoundingBoxAscent, size * 0.3);
  const descent = metrics.actualBoundingBoxDescent;
  return { size, width, height: ascent + descent, ascent };
}

function drawWordmarkBlock(
  ctx: SKRSContext2D,
  y: number,
  word: { size: number; width: number; height: number; ascent: number },
): InkBox {
  const x = (STORY_WIDTH - word.width) / 2;
  drawWordmark(ctx, x, y + word.ascent, word.width + 1, word.size);
  return { x, y, width: word.width, height: word.height };
}

function drawHook(ctx: SKRSContext2D, y: number, hook: HookMeasure): InkBox {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  let baseline = y + hook.ascent;
  let minX = STORY_WIDTH;
  let maxX = 0;
  let last: InkBox | null = null;
  for (const line of hook.lines) {
    setFont(ctx, 800, hook.size, HOOK_TRACKING);
    const x = (STORY_WIDTH - ctx.measureText(line).width) / 2;
    const box = inkBox(ctx, line, x, baseline);
    ctx.fillStyle = INK;
    ctx.fillText(line, x, baseline);
    minX = Math.min(minX, box.x);
    maxX = Math.max(maxX, box.x + box.width);
    last = box;
    baseline += hook.lineHeight;
  }
  if (last) {
    ctx.fillStyle = ACCENT;
    roundRect(
      ctx,
      last.x,
      last.y + last.height + hook.underlineGap,
      last.width,
      hook.underline,
      hook.underline / 2,
    );
    ctx.fill();
  }
  return { x: minX, y, width: Math.max(0, maxX - minX), height: hook.height };
}

function measurePill(ctx: SKRSContext2D, text: string): { size: number; width: number } {
  const padding = 32;
  const size = fitFont(ctx, text, 800, 34, STORY_CONTENT - padding * 2);
  return { size, width: ctx.measureText(text).width + padding * 2 };
}

function drawPill(ctx: SKRSContext2D, y: number, text: string, pill: { size: number; width: number }): InkBox {
  const x = (STORY_WIDTH - pill.width) / 2;
  ctx.fillStyle = ACCENT;
  roundRect(ctx, x, y, pill.width, PILL_H, PILL_H / 2);
  ctx.fill();
  ctx.lineWidth = LINE - 2;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  setFont(ctx, 800, pill.size);
  ctx.fillText(text, x + 32, y + PILL_H / 2 + pill.size * 0.34);
  return { x, y, width: pill.width, height: PILL_H };
}

function drawWinnerPanel(
  ctx: SKRSContext2D,
  y: number,
  winner: string,
  entries: string,
): { panel: InkBox; username: InkBox } {
  const face = { x: STORY_MARGIN, y, width: STORY_CONTENT - SHADOW, height: PANEL_H };
  raisedBox(ctx, face, 44, WHITE);
  const innerX = face.x + 52;
  const innerW = face.width - 104;

  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  setFont(ctx, 800, 28, 0.12);
  ctx.fillText("TODAY'S PICK", innerX, y + 68);

  const usernameSize = fitFont(ctx, winner, 800, 76, innerW, -0.02);
  const usernameBaseline = y + 172;
  const usernameBox = inkBox(ctx, winner, innerX, usernameBaseline);
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
  setFont(ctx, 800, usernameSize, -0.02);
  ctx.fillText(winner, innerX, usernameBaseline);

  ctx.fillStyle = MUTED;
  fitFont(ctx, entries, 600, 32, innerW);
  ctx.fillText(entries, innerX, y + 250);

  return {
    panel: { x: face.x, y: face.y, width: face.width + SHADOW, height: face.height + SHADOW },
    username: usernameBox,
  };
}

function measureSteps(ctx: SKRSContext2D): { size: number; height: number } {
  const textWidth = STORY_CONTENT - STEP_BALL - 24;
  let size = 34;
  for (const step of STORY_STEPS) size = Math.min(size, fitFont(ctx, step, 700, size, textWidth));
  const shadow = STEP_BALL * 0.06;
  return { size, height: STEP_PITCH * (STORY_STEPS.length - 1) + STEP_BALL + shadow };
}

function drawSteps(ctx: SKRSContext2D, y: number, size: number): InkBox {
  const tones: Tone[] = ["accent", "paper", "ink"];
  const textX = STORY_MARGIN + STEP_BALL + 22;
  STORY_STEPS.forEach((step, index) => {
    const cy = y + STEP_BALL / 2 + index * STEP_PITCH;
    drawBall(ctx, STORY_MARGIN + STEP_BALL / 2, cy, STEP_BALL, tones[index] ?? "ink", String(index + 1), null);
    ctx.fillStyle = INK;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    setFont(ctx, 700, size);
    ctx.fillText(step, textX, cy + 1);
  });
  const shadow = STEP_BALL * 0.06;
  return {
    x: STORY_MARGIN,
    y,
    width: STORY_CONTENT,
    height: STEP_PITCH * (STORY_STEPS.length - 1) + STEP_BALL + shadow,
  };
}

function drawReassurance(ctx: SKRSContext2D, y: number): InkBox {
  const face = { x: STORY_MARGIN, y, width: STORY_CONTENT - SHADOW, height: BUTTON_H };
  raisedBox(ctx, face, BUTTON_H / 2, ACCENT);
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  setFont(ctx, 800, 40);
  ctx.fillText(STORY_REASSURANCE, face.x + face.width / 2, y + BUTTON_H / 2 + 14);
  return { x: face.x, y: face.y, width: face.width + SHADOW, height: BUTTON_H + SHADOW };
}

/** Draws the 1080×1920 story. The hook is chosen from the draw number. */
export function layoutResultStory(input: StoryCardInput): StoryLayout {
  const canvas: Canvas = createCanvas(STORY_WIDTH, STORY_HEIGHT);
  const ctx = canvas.getContext("2d");
  paintPaper(ctx, STORY_WIDTH, STORY_HEIGHT);

  const winnerName = input.winnerUsername?.replace(/^@+/, "") ?? "";
  const winner = winnerName ? `@${winnerName}` : null;
  const hookText = winner ? storyHook(input.drawNumber) : EMPTY_STORY_HOOK;
  const header = `Draw #${input.drawNumber} · ${input.dateLabel}`;
  const entries = `picked from ${input.entryCount.toLocaleString("en-GB")} ${
    input.entryCount === 1 ? "entry" : "entries"
  }`;

  const balls = ballsBlock();
  const word = measureWordmarkBlock(ctx);
  const hook = measureHook(ctx, hookText, STORY_CONTENT - 8);
  const pill = measurePill(ctx, header);
  const steps = measureSteps(ctx);
  const buttonH = BUTTON_H + SHADOW;
  const panelH = winner ? PANEL_H + SHADOW : 0;
  const heights = [balls.height, word.height, hook.height, PILL_H, ...(winner ? [panelH] : []), steps.height, buttonH];
  const safeHeight = STORY_HEIGHT - STORY_SAFE_INSET * 2;
  const content = heights.reduce((sum, height) => sum + height, 0);
  // A full story fills the safe zone. An empty night has no winner panel, so
  // the gap stays the same and the group is centred, instead of a hole
  // opening above the button.
  const evenGap = (safeHeight - content) / (heights.length + 1);
  const gap = Math.min(44, evenGap);
  const cluster = content + gap * (heights.length - 1);
  let y = STORY_SAFE_INSET + (safeHeight - cluster) / 2;
  const blocks: InkBox[] = [];
  blocks.push(drawBalls(ctx, y));
  y += balls.height + gap;
  blocks.push(drawWordmarkBlock(ctx, y, word));
  y += word.height + gap;
  const hookBox = drawHook(ctx, y, hook);
  blocks.push(hookBox);
  y += hook.height + gap;
  blocks.push(drawPill(ctx, y, header, pill));
  y += PILL_H + gap;

  let panel: InkBox | null = null;
  let username: InkBox | null = null;
  if (winner) {
    const drawn = drawWinnerPanel(ctx, y, winner, entries);
    panel = drawn.panel;
    username = drawn.username;
    blocks.push(panel);
    y += panelH + gap;
  }

  blocks.push(drawSteps(ctx, y, steps.size));
  y += steps.height + gap;
  blocks.push(drawReassurance(ctx, y));

  return { canvas, hookText, blocks, hook: hookBox, username, panel };
}

/** The story as a JPEG. Encoding runs off the main thread. */
export async function renderResultStoryJpeg(input: StoryCardInput): Promise<Buffer> {
  return layoutResultStory(input).canvas.encode("jpeg", JPEG_QUALITY);
}
