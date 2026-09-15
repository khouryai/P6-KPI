// Generates public/icon-192.png and public/icon-512.png with no image library:
// a navy rounded square with a white S-curve. Pure Node (zlib + PNG chunks).
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function make(size) {
  const r = size * 0.18;
  const inside = (x, y) => {
    const cx = Math.min(Math.max(x, r), size - r), cy = Math.min(Math.max(y, r), size - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  // S-curve: logistic across the square, stroke width ~ size/14
  const curveY = (x) => size * (0.85 - 0.7 / (1 + Math.exp(-((x / size) - 0.5) * 12)));
  const w = size / 14;
  return png(size, (x, y) => {
    if (!inside(x + 0.5, y + 0.5)) return [0, 0, 0, 0];
    const t = x / size;
    if (t > 0.12 && t < 0.88) {
      const d = Math.abs(y - curveY(x));
      if (d < w) return [255, 255, 255, 255];
      if (d < w + 1.5) return [255, 255, 255, Math.round(255 * (w + 1.5 - d) / 1.5)];
    }
    // baseline axis
    if (y > size * 0.86 && y < size * 0.86 + size / 40 && t > 0.1 && t < 0.9) return [245, 158, 11, 255];
    return [30, 58, 95, 255];
  });
}
writeFileSync('public/icon-192.png', make(192));
writeFileSync('public/icon-512.png', make(512));

// A Windows .ico for the desktop/taskbar shortcut. Since Vista an ICO may hold
// PNG payloads directly, so the same generator serves both.
function ico(sizes) {
  const images = sizes.map((s) => ({ size: s, png: make(s) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);
  const entries = Buffer.alloc(16 * images.length);
  let offset = header.length + entries.length;
  images.forEach((img, i) => {
    const o = i * 16;
    entries[o] = img.size >= 256 ? 0 : img.size; // 0 means 256
    entries[o + 1] = img.size >= 256 ? 0 : img.size;
    entries[o + 2] = 0; // palette
    entries[o + 3] = 0; // reserved
    entries.writeUInt16LE(1, o + 4); // colour planes
    entries.writeUInt16LE(32, o + 6); // bits per pixel
    entries.writeUInt32LE(img.png.length, o + 8);
    entries.writeUInt32LE(offset, o + 12);
    offset += img.png.length;
  });
  return Buffer.concat([header, entries, ...images.map((i) => i.png)]);
}
writeFileSync('public/icon.ico', ico([16, 32, 48, 256]));
console.log('icons written, including public/icon.ico');
