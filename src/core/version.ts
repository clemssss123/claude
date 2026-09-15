/**
 * What this build is, and where newer ones come from.
 *
 * `BUILD_STAMP` is the moment the source this build was made from was last
 * changed. The update check compares it against the latest commit on the
 * branch, which is the one piece of information a downloaded zip cannot work
 * out for itself — it arrives without any git history.
 *
 * Bump the stamp with every change that is worth shipping.
 */

export const APP_VERSION = '0.1.0';
export const BUILD_STAMP = '2026-09-15T13:38:00Z';
export const SOURCE_OWNER = 'clemssss123';
export const SOURCE_REPO = 'claude';
export const SOURCE_BRANCH = 'claude/epic-clarke-js2ou0';

export const DOWNLOAD_URL =
  `https://github.com/${SOURCE_OWNER}/${SOURCE_REPO}/archive/refs/heads/${SOURCE_BRANCH}.zip`;
export const DESKTOP_BUILDS_URL =
  `https://github.com/${SOURCE_OWNER}/${SOURCE_REPO}/actions/workflows/desktop.yml`;

/** A short, readable version for the title bar and the about line. */
export function buildLabel(): string {
  const stamp = new Date(BUILD_STAMP);
  if (Number.isNaN(stamp.getTime())) return APP_VERSION;
  return `${APP_VERSION} · ${stamp.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}
