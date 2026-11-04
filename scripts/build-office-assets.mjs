// Builds the Live Agent Office assets from the scene bundle exported by the office editor.
//
//   npm run office:assets
//
// Reads office/office_1_data.json (≈10 MB, frames embedded as data URIs, or files under office/ for the editor's
// built-in characters) and writes:
//   public/office/<seat>-<hash>.webp  one horizontal sprite sheet per seat (its typing frames, 2× the seat width)
//   lib/office-scene.json             positions, sizes, frame counts and sheet paths for the UI
// The browser only ever loads the sheets and the background image, never the bundle.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const BUNDLE = path.join(ROOT, "office/office_1_data.json");
const OUT_DIR = path.join(ROOT, "public/office");
const MANIFEST = path.join(ROOT, "lib/office-scene.json");
// The office picture shipped in public/ (same image as the bundle's background).
const BACKGROUND = "/office-space.webp";
// Sheets are rendered at 2× the seat width so characters stay sharp on high-density screens.
const SCALE = 2;

const bundle = JSON.parse(readFileSync(BUNDLE, "utf8"));

/**
 * A frame is either an embedded data URI or a path relative to the office/ folder. Characters built into the editor
 * are exported as paths (e.g. /characters/rightfacing/typing/frame_001.png): download them from the editor
 * (https://agent-office-editor.vercel.app + the path) into office/ at the same path.
 */
function loadFrame(ref) {
  if (ref.startsWith("data:")) return Buffer.from(ref.slice(ref.indexOf(",") + 1), "base64");
  const file = path.join(ROOT, "office", ref);
  return existsSync(file) ? readFileSync(file) : null;
}

function framesOf(seat) {
  const buffers = seat.character.animations.typing.map(loadFrame);
  return buffers.every(Boolean) ? buffers : null;
}

/** Where the head is, as fractions of the frame: the top of the opaque pixels and the middle of the top 12 % of them. */
async function headOf(buffer, width, height) {
  const { data, info } = await sharp(buffer).resize(width, height, { fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alpha = (x, y) => data[(y * info.width + x) * info.channels + 3];
  let top = 0;
  find: for (; top < info.height; top++) for (let x = 0; x < info.width; x++) if (alpha(x, top) > 128) break find;
  let minX = info.width;
  let maxX = 0;
  const band = Math.round(info.height * 0.12);
  for (let y = top; y < Math.min(info.height, top + band); y++) {
    for (let x = 0; x < info.width; x++) {
      if (alpha(x, y) > 128) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
    }
  }
  const round = (n) => Math.round(n * 1000) / 1000;
  return { x: round((minX + maxX) / 2 / info.width), y: round(top / info.height) };
}

mkdirSync(OUT_DIR, { recursive: true });
for (const file of readdirSync(OUT_DIR)) if (file.endsWith(".webp")) rmSync(path.join(OUT_DIR, file));

const seats = [];
for (const seat of bundle.seats) {
  const frames = framesOf(seat);
  if (!frames) {
    throw new Error(`${seat.label}: frames not found. Download ${seat.character.animations.typing[0]} … from the editor into office/.`);
  }

  const { character } = seat;
  const frameWidth = seat.width * SCALE;
  const frameHeight = Math.round((frameWidth * character.height) / character.width);
  const resized = await Promise.all(
    frames.map((buffer) => sharp(buffer).resize(frameWidth, frameHeight, { fit: "fill" }).png().toBuffer())
  );
  const sheet = await sharp({
    create: { width: frameWidth * frames.length, height: frameHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(resized.map((input, i) => ({ input, left: i * frameWidth, top: 0 })))
    .webp({ quality: 80, alphaQuality: 90, effort: 6 })
    .toBuffer();

  const hash = createHash("sha1").update(sheet).digest("hex").slice(0, 8);
  const file = `${seat.id}-${hash}.webp`;
  writeFileSync(path.join(OUT_DIR, file), sheet);

  seats.push({
    id: seat.id,
    label: seat.label,
    x: seat.x,
    y: seat.y,
    width: seat.width,
    height: Math.round(frameHeight / SCALE),
    zIndex: seat.zIndex,
    frames: frames.length,
    sprite: `/office/${file}`,
    head: await headOf(frames[0], frameWidth, frameHeight),
  });
  console.log(`✓ ${seat.label}: ${frames.length} frames → ${file} (${Math.round(sheet.length / 1024)} KB)`);
}

const manifest = { width: bundle.office.width, height: bundle.office.height, background: BACKGROUND, seats };
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`✓ ${path.relative(ROOT, MANIFEST)}`);
