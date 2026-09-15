import {
  BUILD_STAMP, SOURCE_BRANCH, SOURCE_OWNER, SOURCE_REPO,
} from '@/core/version';

/**
 * Checking whether a newer build exists.
 *
 * The editor ships as source, so "is there an update" is really "has the
 * branch moved since this copy was made". GitHub's API answers that in one
 * request, and the answer carries the commit message, which is the part
 * worth reading before deciding to update.
 */

export interface UpdateInfo {
  state: 'current' | 'available' | 'failed';
  /** Headline of the newest commit, when there is one. */
  headline?: string;
  /** When that commit landed. */
  when?: string;
  /** Short commit id, for saying exactly what is being offered. */
  id?: string;
  /** How many commits ahead, when the API will say. */
  behind?: number;
  message?: string;
}

interface CommitResponse {
  sha?: string;
  commit?: { message?: string; committer?: { date?: string } };
}

const API = 'https://api.github.com';

export async function checkForUpdate(): Promise<UpdateInfo> {
  const url = `${API}/repos/${SOURCE_OWNER}/${SOURCE_REPO}/commits/${encodeURIComponent(SOURCE_BRANCH)}`;
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  } catch {
    return { state: 'failed', message: 'Could not reach GitHub. Are you online?' };
  }

  if (response.status === 403) {
    return { state: 'failed', message: 'GitHub is rate-limiting this address. Try again in a few minutes.' };
  }
  if (!response.ok) {
    return { state: 'failed', message: `GitHub answered ${response.status}.` };
  }

  const body = (await response.json()) as CommitResponse;
  const when = body.commit?.committer?.date;
  if (!when) return { state: 'failed', message: 'GitHub did not say when the branch last changed.' };

  const latest = new Date(when).getTime();
  const built = new Date(BUILD_STAMP).getTime();
  const headline = (body.commit?.message ?? '').split('\n')[0];
  const id = body.sha?.slice(0, 7);

  if (!Number.isFinite(latest) || !Number.isFinite(built)) {
    return { state: 'failed', message: 'Could not compare the two versions.' };
  }
  // A minute of slack: the stamp is written by hand and the commit lands
  // moments later, which would otherwise read as permanently out of date.
  if (latest <= built + 60_000) {
    return { state: 'current', when, headline, id };
  }
  return { state: 'available', when, headline, id };
}

/** How long ago, in words. */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const seconds = Math.max(0, (Date.now() - then) / 1000);
  const units: [number, string][] = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [7, 'day'],
    [4.35, 'week'],
    [12, 'month'],
  ];
  let value = seconds;
  let name = 'second';
  for (const [size, unit] of units) {
    if (value < size) {
      name = unit;
      break;
    }
    value /= size;
    name = unit;
  }
  const rounded = Math.round(value);
  return `${rounded} ${name}${rounded === 1 ? '' : 's'} ago`;
}
