import { deflateSync } from "node:zlib";
import { writeFile } from "node:fs/promises";

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function insideRoundedRect(x, y, left, top, right, bottom, radius) {
  const cx = Math.max(left + radius, Math.min(x, right - radius));
  const cy = Math.max(top + radius, Math.min(y, bottom - radius));
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function createIcon(size) {
  const pixels = Buffer.alloc(size * (size * 4 + 1));
  const scale = size / 128;
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    for (let x = 0; x < size; x += 1) {
      const p = row + 1 + x * 4;
      const px = (x + 0.5) / scale;
      const py = (y + 0.5) / scale;
      let color = [103, 86, 232, 255];
      if (insideRoundedRect(px, py, 22, 39, 106, 103, 12)) color = [255, 253, 248, 255];
      if ((px - 39) ** 2 + (py - 59) ** 2 < 30) color = [103, 86, 232, 255];
      const onLine = px >= 51 && px <= 88 && Math.abs(py - 59) <= 3.5
        || px >= 38 && px <= 88 && Math.abs(py - 76) <= 3.5
        || px >= 38 && px <= 72 && Math.abs(py - 89) <= 3.5;
      if (onLine) color = [103, 86, 232, 255];
      pixels.set(color, p);
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

for (const size of [16, 32, 48, 128]) {
  await writeFile(`assets/icon-${size}.png`, createIcon(size));
}
