/**
 * Bump the user-facing app version in src/app-version.json.
 * Format: MAJOR.MINOR (display as vMAJOR.MINOR).
 * Minor goes 0–9, then major increments and minor resets (7.9 → 8.0).
 * This file is the single source of truth for local and deploy builds.
 *
 *   node scripts/bump-app-version.mjs          # 7.0 → 7.1, …, 7.9 → 8.0
 *   node scripts/bump-app-version.mjs --set 7.0
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION_PATH = path.resolve(__dirname, '../src/app-version.json');

function parseVersion(raw) {
  const cleaned = String(raw ?? '').trim().replace(/^v/i, '');
  const match = cleaned.match(/^(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Unsupported app version "${raw}". Expected MAJOR.MINOR (e.g. 5.0).`);
  }
  return { major: Number(match[1]), minor: Number(match[2]) };
}

function formatVersion(major, minor) {
  return `${major}.${minor}`;
}

const setArg = process.argv.find(arg => arg.startsWith('--set='));
const setIndex = process.argv.indexOf('--set');
const setValue = setArg
  ? setArg.slice('--set='.length)
  : (setIndex >= 0 ? process.argv[setIndex + 1] : null);

const current = JSON.parse(fs.readFileSync(VERSION_PATH, 'utf8'));
let nextVersion;

if (setValue) {
  const parsed = parseVersion(setValue);
  nextVersion = formatVersion(parsed.major, parsed.minor);
} else {
  const parsed = parseVersion(current.version);
  let { major, minor } = parsed;
  minor += 1;
  if (minor > 9) {
    major += 1;
    minor = 0;
  }
  nextVersion = formatVersion(major, minor);
}

const next = { version: nextVersion };
fs.writeFileSync(VERSION_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
console.log(`App version: ${current.version} → ${nextVersion}`);
