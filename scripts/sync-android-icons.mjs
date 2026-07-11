/**
 * Copy PWA icons into Android launcher mipmaps (same mark as public/icons).
 * Usage: node scripts/sync-android-icons.mjs
 */

import sharp from 'sharp';
import { mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const srcIcon = path.join(root, 'public', 'icons', 'icon-512.png');
const resDir = path.join(root, 'android', 'app', 'src', 'main', 'res');

/** density → launcher icon px (48dp) and adaptive foreground px (108dp) */
const DENSITIES = [
  { folder: 'mipmap-mdpi', launcher: 48, foreground: 108 },
  { folder: 'mipmap-hdpi', launcher: 72, foreground: 162 },
  { folder: 'mipmap-xhdpi', launcher: 96, foreground: 216 },
  { folder: 'mipmap-xxhdpi', launcher: 144, foreground: 324 },
  { folder: 'mipmap-xxxhdpi', launcher: 192, foreground: 432 },
];

async function writePng(buffer, outPath) {
  await sharp(buffer).png().toFile(outPath);
  console.log(`  ✓ ${path.relative(root, outPath)}`);
}

for (const { folder, launcher, foreground } of DENSITIES) {
  const dir = path.join(resDir, folder);
  mkdirSync(dir, { recursive: true });

  const launcherBuf = await sharp(srcIcon).resize(launcher, launcher).png().toBuffer();
  await writePng(launcherBuf, path.join(dir, 'ic_launcher.png'));
  await writePng(launcherBuf, path.join(dir, 'ic_launcher_round.png'));

  // Adaptive foreground: full-bleed PWA icon at 108dp
  const fgBuf = await sharp(srcIcon).resize(foreground, foreground).png().toBuffer();
  await writePng(fgBuf, path.join(dir, 'ic_launcher_foreground.png'));
}

console.log('\nAndroid launcher icons synced from public/icons/icon-512.png');
