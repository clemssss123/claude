import { useEffect, useState } from 'react';
import {
  APP_VERSION, BUILD_STAMP, DESKTOP_BUILDS_URL, DOWNLOAD_URL, SOURCE_BRANCH, buildLabel,
} from '@/core/version';
import { desktop, isDesktop } from '@/state/desktop';
import { checkForUpdate, timeAgo } from '@/state/updates';
import type { UpdateInfo } from '@/state/updates';

/**
 * What version this is, and whether a newer one exists.
 *
 * The editor is distributed as source, so it cannot replace itself; what it
 * can do is tell you exactly what you are running, what has changed since,
 * and put the download one click away instead of three.
 */
export function UpdateDialog({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  const run = () => {
    setChecking(true);
    void checkForUpdate().then((result) => {
      setInfo(result);
      setChecking(false);
    });
  };

  useEffect(run, []);

  const open = (url: string) => {
    // An older desktop build has no openExternal; fall back rather than fail.
    const bridge = desktop();
    if (bridge?.openExternal) void bridge.openExternal(url);
    else window.open(url, '_blank', 'noopener');
  };

  const copy = (text: string, label: string) => {
    void navigator.clipboard?.writeText(text).then(
      () => setCopied(label),
      () => setCopied(null),
    );
  };

  const pullCommand = `git pull origin ${SOURCE_BRANCH}`;

  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className="modal" style={{ width: 520 }} onPointerDown={(e) => e.stopPropagation()}>
        <header>Updates</header>
        <div className="content">
          <div className="update-row">
            <span className="update-label">This build</span>
            <span>{buildLabel()}</span>
          </div>
          <div className="update-row">
            <span className="update-label">Running as</span>
            <span>{isDesktop() ? 'Desktop app' : 'Browser'}</span>
          </div>

          {checking && <p className="update-note">Asking GitHub what the latest is…</p>}

          {!checking && info?.state === 'current' && (
            <p className="update-note update-good">
              Up to date. The branch has not moved since this build.
            </p>
          )}

          {!checking && info?.state === 'failed' && (
            <p className="update-note update-bad">{info.message}</p>
          )}

          {!checking && info?.state === 'available' && (
            <>
              <p className="update-note update-good">A newer version is available.</p>
              <div className="update-row">
                <span className="update-label">Latest</span>
                <span>
                  {info.headline}
                  {info.id ? ` (${info.id})` : ''}
                </span>
              </div>
              {info.when && (
                <div className="update-row">
                  <span className="update-label">Committed</span>
                  <span>{timeAgo(info.when)}</span>
                </div>
              )}

              <p className="update-note">
                {isDesktop()
                  ? 'Desktop builds are produced by the Desktop build workflow; open it, take '
                    + 'the newest run’s artifact and run the installer over this one. Your '
                    + 'projects and imported footage stay where they are.'
                  : 'If you cloned with git, pull and the dev server reloads by itself. If you '
                    + 'downloaded the zip, take a fresh one and extract it over your folder — '
                    + 'keep node_modules, nothing needs reinstalling unless the dependencies '
                    + 'changed.'}
              </p>

              <div className="update-actions">
                {isDesktop() ? (
                  <button className="active" onClick={() => open(DESKTOP_BUILDS_URL)}>
                    Open desktop builds
                  </button>
                ) : (
                  <button className="active" onClick={() => open(DOWNLOAD_URL)}>
                    Download the zip
                  </button>
                )}
                <button onClick={() => copy(pullCommand, 'command')}>
                  {copied === 'command' ? 'Copied' : 'Copy git pull command'}
                </button>
              </div>
            </>
          )}

          <p className="update-note update-dim">
            Version {APP_VERSION}, built from source last changed {timeAgo(BUILD_STAMP)}.
          </p>
        </div>
        <footer>
          <button onClick={run} disabled={checking}>Check again</button>
          <span className="spacer" />
          <button className="active" onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}
