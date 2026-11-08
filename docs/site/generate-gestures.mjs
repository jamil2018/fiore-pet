// Website-only paw gestures derived from the app's native 48px idle artwork.
import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync, deflateSync } from "node:zlib";

const source = readFileSync(new URL("assets/preview.png", import.meta.url));
const width = source.readUInt32BE(16);
const chunks = [];
for (let offset = 8; offset < source.length;) {
  const length = source.readUInt32BE(offset);
  if (source.toString("ascii", offset + 4, offset + 8) === "IDAT")
    chunks.push(source.subarray(offset + 8, offset + 8 + length));
  offset += length + 12;
}
const scan = inflateSync(Buffer.concat(chunks));
// The app's generator emits unfiltered RGBA PNGs; fail if that contract changes.
if (source[24] !== 8 || source[25] !== 6)
  throw new Error("Expected 8-bit RGBA preview atlas");
for (let y = 0; y < 96; y++)
  if (scan[y * (width * 4 + 1)] !== 0)
    throw new Error("Expected unfiltered PNG");
const atlasWidth = 768;
const atlasHeight = 192;
const atlas = Buffer.alloc(atlasWidth * atlasHeight * 4);
const ink = [73, 55, 71, 255],
  fur = [246, 213, 160, 255],
  light = [255, 240, 204, 255],
  pink = [216, 114, 136, 255];

for (let row = 0; row < 2; row++)
  for (let frame = 0; frame < 8; frame++) {
    const pixels = Buffer.alloc(48 * 48 * 4);
    for (let y = 0; y < 48; y++)
      for (let x = 0; x < 48; x++) {
        const src = y * 2 * (width * 4 + 1) + 1 + x * 2 * 4;
        scan.copy(pixels, (y * 48 + x) * 4, src, src + 4);
      }
    // Remove the lowered left paw, leaving the torso and face intact.
    for (let y = 31; y <= 38; y++)
      for (let x = 10; x <= 16; x++)
        pixels.fill(0, (y * 48 + x) * 4, (y * 48 + x) * 4 + 4);
    function ellipse(cx, cy, rx, ry, color) {
      for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
        for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
          if (
            x >= 0 &&
            x < 48 &&
            y >= 0 &&
            y < 48 &&
            ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1
          )
            pixels.set(color, (y * 48 + x) * 4);
        }
    }
    function line(x0, y0, x1, y1, radius, color) {
      for (let i = 0; i <= 24; i++)
        ellipse(
          x0 + ((x1 - x0) * i) / 24,
          y0 + ((y1 - y0) * i) / 24,
          radius,
          radius,
          color,
        );
    }
    // Keep the gesture close to the shoulder, matching the app's stubby paws.
    const sway = [0, -0.5, -1, -0.5, 0, 0.5, 1, 0.5][frame];
    const x = row === 0 ? 12 + sway : 11 + (frame > 3 ? 0.5 : 0);
    const y = row === 0 ? 29 : 34;
    line(17, 35, x, y, 2.5, ink);
    line(17, 34, x, y, 1.4, fur);
    ellipse(x, y, 2.7, 3, ink);
    ellipse(x, y - 0.5, 1.8, 2, light);
    if (row === 0) {
      ellipse(x, y + 0.5, 1, 1.3, pink);
      ellipse(x - 1, y - 2, 0.6, 0.6, pink);
      ellipse(x + 1, y - 2, 0.6, 0.6, pink);
    } else {
      line(x, y - 1, x - 1, y - 1, 0.8, light);
    }
    for (let y0 = 0; y0 < 96; y0++)
      for (let x0 = 0; x0 < 96; x0++) {
        const src = (Math.floor(y0 / 2) * 48 + Math.floor(x0 / 2)) * 4;
        pixels.copy(
          atlas,
          ((row * 96 + y0) * atlasWidth + frame * 96 + x0) * 4,
          src,
          src + 4,
        );
      }
  }
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4),
    checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, body, checksum]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(atlasWidth);
header.writeUInt32BE(atlasHeight, 4);
header[8] = 8;
header[9] = 6;
const output = Buffer.alloc((atlasWidth * 4 + 1) * atlasHeight);
for (let y = 0; y < atlasHeight; y++)
  atlas.copy(
    output,
    y * (atlasWidth * 4 + 1) + 1,
    y * atlasWidth * 4,
    (y + 1) * atlasWidth * 4,
  );
writeFileSync(
  new URL("assets/gestures.png", import.meta.url),
  Buffer.concat([
    source.subarray(0, 8),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(output)),
    chunk("IEND", Buffer.alloc(0)),
  ]),
);
