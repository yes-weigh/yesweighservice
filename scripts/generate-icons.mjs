/**
 * Generates favicon and PWA icons: trimmed logo on a black circular background.
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

const OUTPUTS = [
  { size: 16, name: 'favicon-16.png' },
  { size: 32, name: 'favicon-32.png' },
  { size: 48, name: 'favicon-48.png' },
  { size: 180, name: 'apple-touch-icon.png' },
  { size: 192, name: 'icon-192.png' },
  { size: 512, name: 'icon-512.png' },
  { size: 512, name: 'icon-512-maskable.png', maskable: true },
];

/** Trim empty/black padding so the mark fills more of the tab icon. */
async function loadTrimmedLogo() {
  return sharp(logoPath).trim({ threshold: 12 }).png().toBuffer();
}

async function makeIcon(trimmedLogo, size, maskable = false) {
  // Maskable icons keep Android safe-zone padding; tab icons use the full circle.
  const insetRatio = maskable ? 0.18 : 0.06;
  const inset = Math.round(size * insetRatio);
  const logoMax = size - inset * 2;

  const circleSvg = Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#000000"/>
    </svg>`,
  );

  const logo = await sharp(trimmedLogo)
    .resize(logoMax, logoMax, { fit: 'inside' })
    .png()
    .toBuffer();

  return sharp(circleSvg).composite([{ input: logo, gravity: 'center' }]).png().toBuffer();
}

mkdirSync(outDir, { recursive: true });

const trimmedLogo = await loadTrimmedLogo();

for (const { size, name, maskable = false } of OUTPUTS) {
  const buffer = await makeIcon(trimmedLogo, size, maskable);
  await sharp(buffer).toFile(path.join(outDir, name));
  console.log(`  ✓ ${name}`);
}

console.log('\nIcons written to public/icons/');
