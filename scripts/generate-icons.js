#!/usr/bin/env node
// Generate icon.ico for Windows from icon.png
// Uses macOS sips for resizing + manual ICO assembly

const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'desktop', 'build', 'icon.png');
const outIco = path.join(root, 'desktop', 'build', 'icon.ico');
const tmpDir = '/tmp/paw-ico-gen';

if (!fs.existsSync(src)) {
  console.error('Source icon not found:', src);
  process.exit(1);
}

if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

const sizes = [16, 24, 32, 48, 64, 128, 256];

// Generate each size with sips
for (const s of sizes) {
  execSync(`sips -z ${s} ${s} "${src}" --out "${tmpDir}/icon_${s}.png"`, { stdio: 'pipe' });
}

// Read all PNGs
const images = sizes.map(s => fs.readFileSync(`${tmpDir}/icon_${s}.png`));

// Build ICO file
const count = images.length;
const headerSize = 6;
const entrySize = 16;
const dataOffset = headerSize + (entrySize * count);

let totalDataSize = 0;
for (const img of images) totalDataSize += img.length;

const ico = Buffer.alloc(dataOffset + totalDataSize);

// ICO header
ico.writeUInt16LE(0, 0);       // reserved
ico.writeUInt16LE(1, 2);       // type = ICO
ico.writeUInt16LE(count, 4);   // image count

let offset = dataOffset;
for (let i = 0; i < count; i++) {
  const s = sizes[i];
  const e = headerSize + (i * entrySize);
  ico.writeUInt8(s < 256 ? s : 0, e);       // width
  ico.writeUInt8(s < 256 ? s : 0, e + 1);   // height
  ico.writeUInt8(0, e + 2);                  // palette
  ico.writeUInt8(0, e + 3);                  // reserved
  ico.writeUInt16LE(1, e + 4);              // color planes
  ico.writeUInt16LE(32, e + 6);             // bits per pixel
  ico.writeUInt32LE(images[i].length, e + 8);  // data size
  ico.writeUInt32LE(offset, e + 12);        // data offset
  images[i].copy(ico, offset);
  offset += images[i].length;
}

fs.writeFileSync(outIco, ico);
console.log(`icon.ico generated: ${(ico.length / 1024).toFixed(1)} KB (${sizes.join(', ')}px)`);

// Cleanup
fs.rmSync(tmpDir, { recursive: true, force: true });
