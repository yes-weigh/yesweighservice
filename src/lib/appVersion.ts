import appVersion from '../app-version.json';

/** Raw version string from src/app-version.json (e.g. "5.0"). */
export function getAppVersion(): string {
  return String(appVersion?.version ?? '0').trim() || '0';
}

/** Display label for UI (e.g. "v5.0"). */
export function getAppVersionLabel(): string {
  const version = getAppVersion();
  return version.startsWith('v') || version.startsWith('V') ? version : `v${version}`;
}
