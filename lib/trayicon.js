'use strict';
// Limieten buiten de widget tonen.
// Windows/Linux: het systeemvakicoon wordt een ring (of twee) die meekleurt, zoals in de pil.
// macOS: de percentages als tekst in de menubalk, naast het icoon.
// Geen Electron hier: alles is te testen met node:test.

const zlib = require('zlib');

const MODES = ['both', 'fiveHour', 'sevenDay', 'off'];

// Zelfde drempels als de widget; middentonen, zodat ze op een lichte én donkere taakbalk opvallen.
const COLORS = { ok: [24, 190, 140, 255], warn: [245, 158, 11, 255], crit: [239, 68, 88, 255] };
const TRACK = [150, 150, 160, 120];
const level = (pct) => (pct >= 80 ? 'crit' : pct >= 50 ? 'warn' : 'ok');

const pct = (w) => (w && typeof w.percent === 'number' ? Math.round(w.percent) : null);

// Welke ringen bij een stand horen: buiten de week, binnen de 5 uur (zoals in de pil).
// Straal en dikte als deel van de icoongrootte. Null: geen eigen icoon (standaardicoon tonen).
function ringsFor(usage, mode) {
  if (!usage || mode === 'off') return null;
  const five = pct(usage.fiveHour);
  const week = pct(usage.sevenDay);
  if (mode === 'fiveHour' || mode === 'sevenDay') {
    const p = mode === 'fiveHour' ? five : week;
    return p === null ? null : [{ percent: p, r: 0.34, w: 0.26 }];
  }
  const rings = [];
  if (week !== null) rings.push({ percent: week, r: 0.4, w: 0.17 });
  if (five !== null) rings.push({ percent: five, r: 0.17, w: 0.17 });
  return rings.length ? rings : null;
}

// RGBA-pixels (niet voorvermenigvuldigd) van de ringen, met 4x4 subpixels tegen kartelranden.
function drawRings(size, rings) {
  const out = new Uint8Array(size * size * 4);
  const N = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const dx = x + (sx + 0.5) / N - size / 2;
          const dy = y + (sy + 0.5) / N - size / 2;
          const d = Math.hypot(dx, dy);
          const turn = (Math.atan2(dx, -dy) / (2 * Math.PI) + 1) % 1; // vanaf 12 uur, met de klok mee
          const ring = rings.find((k) => Math.abs(d - k.r * size) <= (k.w * size) / 2);
          if (!ring) continue;
          const c = turn < ring.percent / 100 ? COLORS[level(ring.percent)] : TRACK;
          r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
        }
      }
      const i = (y * size + x) * 4;
      if (a > 0) {
        out[i] = Math.round(r / a);
        out[i + 1] = Math.round(g / a);
        out[i + 2] = Math.round(b / a);
        out[i + 3] = Math.round(a / (N * N));
      }
    }
  }
  return out;
}

// ---------- PNG schrijven (RGBA, 8 bit) ----------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bitdiepte
  header[9] = 6; // RGBA
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    rows[y * (width * 4 + 1)] = 0; // geen filter
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(rows, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// PNG van het systeemvakicoon op één grootte, of null als het standaardicoon moet blijven.
function ringPng(usage, mode, size) {
  const rings = ringsFor(usage, mode);
  return rings ? encodePng(size, size, drawRings(size, rings)) : null;
}

// Tekst voor de menubalk (macOS), bijv. "5u 77% · wk 61%"; leeg als er niets te tonen is.
function trayTitle(usage, mode) {
  if (!usage || mode === 'off') return '';
  const five = pct(usage.fiveHour);
  const week = pct(usage.sevenDay);
  const parts = [];
  if (mode !== 'sevenDay' && five !== null) parts.push(`5u ${five}%`);
  if (mode !== 'fiveHour' && week !== null) parts.push(`wk ${week}%`);
  return parts.join(' · ');
}

// Sleutel om te zien of het icoon of de tekst opnieuw gemaakt moet worden.
const statusKey = (usage, mode) => `${mode}|${pct(usage && usage.fiveHour)}|${pct(usage && usage.sevenDay)}`;

module.exports = { MODES, ringsFor, drawRings, encodePng, ringPng, trayTitle, statusKey, crc32 };
