/**
 * Generates favicon, PWA icons, and Android launcher icons.
 * Logo on black; Android adaptive foreground uses safe-zone padding
 * so the mark matches the PWA maskable look (not cropped by the launcher mask).
 *
 * Usage: npm run generate:icons
 */

import sharp from 'sharp';
import { mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const logoPath = path.join(root, 'public', 'logo.png');
const outDir = path.join(root, 'public', 'icons');
const androidRes = path.join(root, 'android', 'app', 'src', 'main', 'res');

const PWA_OUTPUTS = [
  { size: 16, name: 'favicon-16.png' },
  { size: 32, name: 'favicon-32.png' },
  { size: 48, name: 'favicon-48.png' },
  { size: 180, name: 'apple-touch-icon.png' },
  { size: 192, name: 'icon-192.png' },
  { size: 512, name: 'icon-512.png' },
  { size: 512, name: 'icon-512-maskable.png', maskable: true },
];

/** Android adaptive foreground canvas sizes (108dp × density). */
const ANDROID_FOREGROUND = [
  { dir: 'mipmap-mdpi', size: 108 },
  { dir: 'mipmap-hdpi', size: 162 },
  { dir: 'mipmap-xhdpi', size: 216 },
  { dir: 'mipmap-xxhdpi', size: 324 },
  { dir: 'mipmap-xxxhdpi', size: 432 },
];

/** Legacy full launcher icon sizes. */
const ANDROID_LAUNCHER = [
  { dir: 'mipmap-mdpi', size: 48 },
  { dir: 'mipmap-hdpi', size: 72 },
  { dir: 'mipmap-xhdpi', size: 96 },
  { dir: 'mipmap-xxhdpi', size: 144 },
  { dir: 'mipmap-xxxhdpi', size: 192 },
];

/** Trim empty/black padding so the mark fills more of the tab icon. */
async function loadTrimmedLogo() {
  return sharp(logoPath).trim({ threshold: 12 }).png().toBuffer();
}

function solidSquare(size, radius = 0) {
  if (radius <= 0) {
    return sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
  }
  return sharp(
    Buffer.from(
      `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#000000"/>
      </svg>`,
    ),
  )
    .png()
    .toBuffer();
}

async function compositeLogo(trimmedLogo, size, insetRatio, radius = 0) {
  const inset = Math.round(size * insetRatio);
  const logoMax = size - inset * 2;
  const background = await solidSquare(size, radius);
  const logo = await sharp(trimmedLogo)
    .resize(logoMax, logoMax, { fit: 'inside' })
    .png()
    .toBuffer();
  return sharp(background).composite([{ input: logo, gravity: 'center' }]).png().toBuffer();
}

mkdirSync(outDir, { recursive: true });

const trimmedLogo = await loadTrimmedLogo();

console.log('PWA / favicon icons');
for (const { size, name, maskable = false } of PWA_OUTPUTS) {
  const insetRatio = maskable ? 0.18 : 0.06;
  const radius = Math.round(size * (maskable ? 0.16 : 0.22));
  const buffer = await compositeLogo(trimmedLogo, size, insetRatio, radius);
  await sharp(buffer).toFile(path.join(outDir, name));
  console.log(`  ✓ ${name}`);
}

console.log('\nAndroid adaptive foreground (safe zone ≈ PWA maskable)');
// ~20% inset each side keeps key content in the Android adaptive safe zone
// (center ~66%), matching how the PWA maskable icon looks on home screens.
const ADAPTIVE_INSET = 0.2;
for (const { dir, size } of ANDROID_FOREGROUND) {
  const dirPath = path.join(androidRes, dir);
  mkdirSync(dirPath, { recursive: true });
  const buffer = await compositeLogo(trimmedLogo, size, ADAPTIVE_INSET, 0);
  await sharp(buffer).toFile(path.join(dirPath, 'ic_launcher_foreground.png'));
  console.log(`  ✓ ${dir}/ic_launcher_foreground.png (${size}×${size})`);
}

console.log('\nAndroid launcher + round');
for (const { dir, size } of ANDROID_LAUNCHER) {
  const dirPath = path.join(androidRes, dir);
  mkdirSync(dirPath, { recursive: true });
  // Match PWA non-maskable padding so the full mark is visible
  const square = await compositeLogo(trimmedLogo, size, 0.1, Math.round(size * 0.22));
  const round = await compositeLogo(trimmedLogo, size, 0.14, Math.round(size / 2));
  await sharp(square).toFile(path.join(dirPath, 'ic_launcher.png'));
  await sharp(round).toFile(path.join(dirPath, 'ic_launcher_round.png'));
  console.log(`  ✓ ${dir}/ic_launcher.png + ic_launcher_round.png (${size}×${size})`);
}

console.log('\nIcons written to public/icons/ and android/.../res/mipmap-*/');
