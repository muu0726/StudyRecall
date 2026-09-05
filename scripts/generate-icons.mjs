/**
 * PWA 用アイコンを生成する使い捨てスクリプト（依存ライブラリなし）。
 * テーマカラーの角丸タイルに白い栞マークを描いた、あくまでプレースホルダ。
 * 実際のブランドアイコンが用意できたら public/ の PNG を差し替えること。
 *
 *   node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const BRAND = [37, 99, 235]; // #2563eb
const WHITE = [255, 255, 255];

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(size, pixelAt) {
  // 各行の先頭にフィルタバイト 0 を置いた RGBA のスキャンライン
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let offset = 0;
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelAt(x, y);
      raw[offset++] = r;
      raw[offset++] = g;
      raw[offset++] = b;
      raw[offset++] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * @param size    出力サイズ
 * @param maskable true なら安全領域を確保するため図形を小さめに描く
 */
function makeIcon(size, maskable) {
  const radius = maskable ? size / 2 : size * 0.22;
  // maskable は中央 80% が安全領域。マークを一回り小さくする。
  const markScale = maskable ? 0.34 : 0.44;
  const markW = size * markScale * 0.62;
  const markH = size * markScale;
  const markX = (size - markW) / 2;
  const markY = (size - markH) / 2;
  const notch = markH * 0.28;

  const inRoundedRect = (x, y) => {
    if (maskable) return true; // 全面塗り。マスクは端末側が行う
    const cx = Math.min(Math.max(x, radius), size - radius);
    const cy = Math.min(Math.max(y, radius), size - radius);
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= radius * radius;
  };

  // 栞（ブックマーク）形: 下端中央に三角の切り欠きを持つ矩形
  const inBookmark = (x, y) => {
    if (x < markX || x > markX + markW || y < markY || y > markY + markH) return false;
    const fromBottom = markY + markH - y;
    if (fromBottom > notch) return true;
    const distFromCenter = Math.abs(x - (markX + markW / 2));
    return distFromCenter >= (notch - fromBottom) * (markW / 2 / notch);
  };

  return encodePng(size, (x, y) => {
    if (!inRoundedRect(x, y)) return [0, 0, 0, 0];
    if (inBookmark(x, y)) return [...WHITE, 255];
    return [...BRAND, 255];
  });
}

mkdirSync('public', { recursive: true });
const outputs = [
  ['public/icon-192.png', makeIcon(192, false)],
  ['public/icon-512.png', makeIcon(512, false)],
  ['public/icon-512-maskable.png', makeIcon(512, true)],
  ['public/apple-touch-icon.png', makeIcon(180, true)],
];
for (const [path, buffer] of outputs) {
  writeFileSync(path, buffer);
  console.log(`${path}  ${buffer.length} bytes`);
}
