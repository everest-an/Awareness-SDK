#!/usr/bin/env node
/**
 * F-109 · deterministic PNG icon renderer (no dependencies).
 *
 * Draws the Awareness mark — a teal ring with three memory nodes — on a deep
 * navy rounded square. Committed PNGs are what the manifest and the Chrome Web
 * Store consume; re-run this only when the brand mark changes.
 *
 *   node scripts/make-icons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'icons');

const TOP = [0x0b, 0x12, 0x20];
const BOTTOM = [0x16, 0x23, 0x3a];
const TEAL = [0x5c, 0xe0, 0xd2];

const SIZES = [16, 32, 48, 128];
const SS = 4; // supersampling per axis

// ---------------------------------------------------------------------------
// PNG encoding.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0; // filter: none
    rgba.copy(raw, row + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Geometry helpers (all in 0..1 normalized coordinates).
// ---------------------------------------------------------------------------

const len = (x, y) => Math.hypot(x, y);

function inRoundRect(x, y, half, r) {
  const dx = Math.max(Math.abs(x - 0.5) - (half - r), 0);
  const dy = Math.max(Math.abs(y - 0.5) - (half - r), 0);
  return len(dx, dy) <= r;
}

function ringAlpha(x, y, radius, thickness) {
  const d = Math.abs(len(x - 0.5, y - 0.5) - radius);
  return d <= thickness / 2;
}

function dotAlpha(x, y, cx, cy, r) {
  return len(x - cx, y - cy) <= r;
}

function segAlpha(x, y, ax, ay, bx, by, w) {
  const vx = bx - ax;
  const vy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy)));
  return len(x - (ax + t * vx), y - (ay + t * vy)) <= w / 2;
}

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function shade(x, y, size) {
  if (!inRoundRect(x, y, 0.5, 0.22)) return [0, 0, 0, 0];

  let rgb = [
    lerp(TOP[0], BOTTOM[0], y),
    lerp(TOP[1], BOTTOM[1], y),
    lerp(TOP[2], BOTTOM[2], y),
  ];

  const cover = (on) => { if (on) rgb = TEAL.slice(); };

  // Ring — thinner relative stroke at tiny sizes so it stays legible.
  const radius = 0.30;
  const thickness = size <= 20 ? 0.11 : 0.075;
  cover(ringAlpha(x, y, radius, thickness));

  // Three nodes + spokes (skip fine detail below 24px).
  if (size > 20) {
    const r = 0.055;
    const reach = 0.115;
    const nodes = [-Math.PI / 2, Math.PI / 6, (5 * Math.PI) / 6].map((a) => [
      0.5 + Math.cos(a) * reach,
      0.5 + Math.sin(a) * reach,
    ]);
    for (let i = 0; i < nodes.length; i++) {
      const [ax, ay] = nodes[i];
      const [bx, by] = nodes[(i + 1) % nodes.length];
      if (segAlpha(x, y, ax, ay, bx, by, 0.028)) rgb = [0x2f, 0x9d, 0x98];
    }
    for (const [nx, ny] of nodes) cover(dotAlpha(x, y, nx, ny, r));
  } else {
    cover(dotAlpha(x, y, 0.5, 0.5, 0.12));
  }

  return [rgb[0], rgb[1], rgb[2], 255];
}

// ---------------------------------------------------------------------------
// Render.
// ---------------------------------------------------------------------------

function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  const step = 1 / (size * SS);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px * SS + sx + 0.5) * step;
          const y = (py * SS + sy + 0.5) * step;
          const [cr, cg, cb, ca] = shade(x, y, size);
          const w = ca / 255;
          r += cr * w; g += cg * w; b += cb * w; a += ca;
        }
      }
      const n = SS * SS;
      const i = (py * size + px) * 4;
      const alpha = a / n;
      // Premultiplied average → straight alpha (avoids dark fringes).
      buf[i] = alpha ? Math.round(r / (a / 255)) : 0;
      buf[i + 1] = alpha ? Math.round(g / (a / 255)) : 0;
      buf[i + 2] = alpha ? Math.round(b / (a / 255)) : 0;
      buf[i + 3] = Math.round(alpha);
    }
  }
  return encodePng(size, size, buf);
}

fs.mkdirSync(OUT, { recursive: true });
for (const size of SIZES) {
  const file = path.join(OUT, `icon-${size}.png`);
  fs.writeFileSync(file, render(size));
  console.log(`wrote ${path.relative(process.cwd(), file)} (${size}x${size})`);
}
