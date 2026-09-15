import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILD_STAMP } from '../version';
import { checkForUpdate, timeAgo } from '@/state/updates';

/** The update check, against the shapes GitHub actually answers with. */

function commitResponse(when: string, message = 'Something changed\n\nmore') {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      sha: '0123456789abcdef',
      commit: { message, committer: { date: when } },
    }),
  } as unknown as Response;
}

function offsetFromBuild(seconds: number): string {
  return new Date(new Date(BUILD_STAMP).getTime() + seconds * 1000).toISOString();
}

afterEach(() => vi.unstubAllGlobals());

describe('checkForUpdate', () => {
  it('reports a newer commit as available, with what it is', async () => {
    vi.stubGlobal('fetch', async () => commitResponse(offsetFromBuild(3600), 'Fix playback\n\nbody'));
    const info = await checkForUpdate();
    expect(info.state).toBe('available');
    expect(info.headline).toBe('Fix playback');
    expect(info.id).toBe('0123456');
  });

  it('treats the build\'s own commit as current', async () => {
    vi.stubGlobal('fetch', async () => commitResponse(BUILD_STAMP));
    expect((await checkForUpdate()).state).toBe('current');
  });

  it('allows a minute of slack, because the stamp is written by hand', async () => {
    vi.stubGlobal('fetch', async () => commitResponse(offsetFromBuild(30)));
    expect((await checkForUpdate()).state).toBe('current');
    vi.stubGlobal('fetch', async () => commitResponse(offsetFromBuild(120)));
    expect((await checkForUpdate()).state).toBe('available');
  });

  it('says so plainly when GitHub is unreachable', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    const info = await checkForUpdate();
    expect(info.state).toBe('failed');
    expect(info.message).toMatch(/online/i);
  });

  it('names a rate limit for what it is', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 403 }) as Response);
    expect((await checkForUpdate()).message).toMatch(/rate-limit/i);
  });

  it('does not crash on an answer without a date', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true, status: 200, json: async () => ({ sha: 'abc' }),
    }) as unknown as Response);
    expect((await checkForUpdate()).state).toBe('failed');
  });
});

describe('timeAgo', () => {
  it('counts in the largest unit that fits', () => {
    const ago = (seconds: number) => timeAgo(new Date(Date.now() - seconds * 1000).toISOString());
    expect(ago(5)).toBe('5 seconds ago');
    expect(ago(60)).toBe('1 minute ago');
    expect(ago(3600 * 5)).toBe('5 hours ago');
    expect(ago(86400 * 3)).toBe('3 days ago');
  });

  it('returns nothing for a date it cannot read', () => {
    expect(timeAgo('not a date')).toBe('');
  });
});
