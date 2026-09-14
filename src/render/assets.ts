import type { Composition, FootageAsset, Id, Layer } from '@/core/types';
import { sourceTimeAt } from '@/core/layer';

/**
 * The runtime side of imported footage.
 *
 * The document only knows an asset's description; the decoded pixels live
 * here. Images become an `ImageBitmap` and are drawn directly. Video is a
 * `<video>` element, which is the awkward one: seeking it is asynchronous, so
 * the viewer draws whatever frame is decoded now and repaints when the seek
 * lands, while export waits for each seek before rendering its frame.
 */

interface LoadedAsset {
  asset: FootageAsset;
  image?: ImageBitmap;
  video?: HTMLVideoElement;
  objectUrl?: string;
  /** Seek currently in flight, if any. */
  seeking?: Promise<void>;
  /** Time requested while a seek was already running. */
  pendingTime?: number;
  /**
   * The time last asked for. A seek lands on the nearest decodable frame,
   * which is rarely the exact time requested, so comparing new requests
   * against `currentTime` would seek again for ever — and a video that is
   * always seeking never has a frame to draw.
   */
  requestedTime?: number;
}

/** Close enough to count as already showing that frame. */
const SEEK_TOLERANCE = 0.001;

const loaded = new Map<Id, LoadedAsset>();
const repaintListeners = new Set<() => void>();
/**
 * Export drives the videos itself, one frame at a time, and cannot share
 * them: a viewer repaint asking for the playhead's frame mid-export would
 * seek the same element backwards and leave the export drawing nothing.
 * While this is set, only `prepareFootageForTime` may move a video.
 */
let exclusive = false;

/** Take sole control of the videos, and give it back when done. */
export function beginExclusiveFootage(): () => void {
  exclusive = true;
  return () => { exclusive = false; };
}

/** Called when a video seek completes, so the viewer can redraw. */
export function onFootageFrameReady(listener: () => void): () => void {
  repaintListeners.add(listener);
  return () => repaintListeners.delete(listener);
}

function notifyRepaint(): void {
  if (exclusive) return;
  for (const listener of repaintListeners) listener();
}

export function isFootageLoaded(id: Id): boolean {
  return loaded.has(id);
}

export function loadedFootageIds(): Id[] {
  return [...loaded.keys()];
}

/** Decode a blob and keep it ready for drawing. */
export async function registerFootage(asset: FootageAsset, blob: Blob): Promise<void> {
  releaseFootage(asset.id);

  if (asset.kind === 'image') {
    const image = await createImageBitmap(blob);
    loaded.set(asset.id, { asset, image });
    return;
  }

  const objectUrl = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.src = objectUrl;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  // Keeping the element out of the document avoids any layout cost.
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error(`Could not decode ${asset.name}.`));
  });
  loaded.set(asset.id, { asset, video, objectUrl });
}

export function releaseFootage(id: Id): void {
  const entry = loaded.get(id);
  if (!entry) return;
  entry.image?.close();
  if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
  if (entry.video) entry.video.src = '';
  loaded.delete(id);
  thumbnails.delete(id);
}

export function releaseAllFootage(): void {
  for (const id of [...loaded.keys()]) releaseFootage(id);
}

/**
 * What to draw for this asset right now. For video this is the frame the
 * element happens to hold, which is the correct one once a seek has landed.
 */
export function footageDrawable(id: Id): CanvasImageSource | null {
  const entry = loaded.get(id);
  if (!entry) return null;
  if (entry.image) return entry.image;
  if (entry.video && entry.video.readyState >= 2) return entry.video;
  return null;
}

/**
 * Ask a video to show a particular time. Returns immediately; the frame
 * arrives with a repaint notification. Requests made during a seek replace
 * one another, so scrubbing chases the latest time rather than queueing.
 */
export function requestFootageTime(id: Id, time: number): void {
  if (exclusive) return;
  const entry = loaded.get(id);
  if (!entry?.video) return;
  const clamped = clampToDuration(entry, time);
  if (alreadyShowing(entry, clamped)) return;

  entry.requestedTime = clamped;
  if (entry.seeking) {
    entry.pendingTime = clamped;
    return;
  }
  startSeek(entry, clamped);
}

/** Whether this time has already been asked for, or is already on screen. */
function alreadyShowing(entry: LoadedAsset, time: number): boolean {
  const asked = entry.requestedTime;
  if (asked !== undefined) return Math.abs(asked - time) <= SEEK_TOLERANCE;
  return Math.abs((entry.video?.currentTime ?? 0) - time) <= SEEK_TOLERANCE;
}

function startSeek(entry: LoadedAsset, time: number): void {
  const video = entry.video;
  if (!video) return;
  entry.seeking = new Promise<void>((resolve) => {
    const done = () => {
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', done);
      entry.seeking = undefined;
      const next = entry.pendingTime;
      entry.pendingTime = undefined;
      if (next !== undefined && Math.abs(video.currentTime - next) > SEEK_TOLERANCE) {
        startSeek(entry, next);
      } else {
        notifyRepaint();
      }
      resolve();
    };
    video.addEventListener('seeked', done);
    video.addEventListener('error', done);
    video.currentTime = time;
  });
}

function clampToDuration(entry: LoadedAsset, time: number): number {
  const duration = entry.video?.duration;
  const limit = Number.isFinite(duration) && duration ? duration - 1 / 1000 : entry.asset.duration;
  return Math.max(0, Math.min(limit || 0, time));
}

/**
 * Put every video in the composition on the right frame and wait for it.
 * Export needs this; the viewer does not, because it repaints on arrival.
 */
export async function prepareFootageForTime(
  comp: Composition,
  time: number,
  resolveComposition?: (id: Id) => Composition | undefined,
  depth = 0,
): Promise<void> {
  if (depth > 8) return;
  const waits: Promise<void>[] = [];

  for (const layer of comp.layers) {
    if (!layer.enabled || time < layer.inPoint || time >= layer.outPoint) continue;

    if (layer.type === 'media') {
      const entry = loaded.get(layer.assetId);
      if (!entry?.video) continue;
      const target = clampToDuration(entry, sourceTimeAt(layer, time));
      if (alreadyShowing(entry, target) && !entry.seeking) continue;
      entry.requestedTime = target;
      if (entry.seeking) entry.pendingTime = target;
      else startSeek(entry, target);
      // Seeks chain, so waiting once is not enough to land on `target`.
      while (entry.seeking) await entry.seeking;
    } else if (layer.type === 'precomp' && resolveComposition) {
      const source = resolveComposition(layer.compId);
      if (source) {
        waits.push(prepareFootageForTime(
          source, sourceTimeAt(layer, time), resolveComposition, depth + 1,
        ));
      }
    }
  }

  await Promise.all(waits);
}

/** Read a file's dimensions and duration without importing it yet. */
export async function probeFootageFile(file: File): Promise<Omit<FootageAsset, 'id'>> {
  const kind: FootageAsset['kind'] = file.type.startsWith('video/') ? 'video' : 'image';
  const base = {
    name: file.name,
    kind,
    size: file.size,
    mimeType: file.type,
  };

  if (kind === 'image') {
    const bitmap = await createImageBitmap(file);
    const probed = {
      ...base,
      width: bitmap.width,
      height: bitmap.height,
      duration: 0,
      frameRate: 0,
    };
    bitmap.close();
    return probed;
  }

  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement('video');
    video.src = url;
    video.muted = true;
    video.preload = 'metadata';
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error(`${file.name} is not a video this browser can read.`));
    });
    return {
      ...base,
      width: video.videoWidth,
      height: video.videoHeight,
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      // Frame rate is not exposed; 30 is the safe assumption for a new layer.
      frameRate: 30,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Longest edge of a Project panel thumbnail, in pixels. */
const THUMB_SIZE = 64;
const thumbnails = new Map<Id, string>();

/**
 * A small still of the asset for the Project panel, drawn once and kept.
 * Video thumbnails use whatever frame the element holds, which is the first
 * frame right after import.
 */
export function footageThumbnail(id: Id): string | null {
  const cached = thumbnails.get(id);
  if (cached) return cached;

  const entry = loaded.get(id);
  const drawable = footageDrawable(id);
  if (!entry || !drawable) return null;

  const { width, height } = entry.asset;
  if (width <= 0 || height <= 0) return null;
  const scale = THUMB_SIZE / Math.max(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  try {
    ctx.drawImage(drawable, 0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }
  const url = canvas.toDataURL('image/png');
  thumbnails.set(id, url);
  return url;
}

export function footageLayers(comp: Composition): Layer[] {
  return comp.layers.filter((layer) => layer.type === 'media');
}
