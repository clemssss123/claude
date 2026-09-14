import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer';
import { setExpressionContext } from '@/core/expressions';
import type { Composition, Id, Project } from '@/core/types';
import { beginExclusiveFootage, prepareFootageForTime } from './assets';
import { renderComposition } from './renderer';
import { ZipWriter } from './zip';

/**
 * Rendering a composition out to a file.
 *
 * Frames are rendered one at a time into an offscreen canvas and handed to a
 * WebCodecs `VideoEncoder`, which returns encoded chunks that a muxer wraps in
 * an MP4 or WebM container. Where WebCodecs is missing — or when frames are
 * wanted individually — the same loop writes a PNG sequence into a zip.
 */

export type ExportFormat = 'mp4' | 'webm' | 'png';

export interface ExportSettings {
  format: ExportFormat;
  /** Which span of the composition to render. */
  range: 'workArea' | 'composition';
  /** 1 = full size, 0.5 = half, and so on. */
  scale: number;
  /** Target video bitrate in bits per second; ignored for a PNG sequence. */
  bitrate: number;
}

export interface ExportProgress {
  frame: number;
  total: number;
  stage: 'rendering' | 'encoding' | 'finishing';
}

export interface ExportResult {
  blob: Blob;
  filename: string;
  frames: number;
  /** Human-readable codec actually used, for the confirmation line. */
  codec: string;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  format: 'mp4',
  range: 'workArea',
  scale: 1,
  bitrate: 12_000_000,
};

export function webCodecsAvailable(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

/**
 * Codec candidates per container, best first.
 *
 * H.264 is the safest MP4 to hand to anything, but it is a licensed codec and
 * plenty of builds — Chromium without proprietary codecs, for one — simply do
 * not have the encoder. Rather than disable MP4 there, the exporter negotiates
 * down to AV1 or VP9 inside the same container.
 */
const MP4_CANDIDATES = [
  { codec: 'avc1.4d0032', muxer: 'avc' },
  { codec: 'avc1.42001f', muxer: 'avc' },
  { codec: 'av01.0.04M.08', muxer: 'av1' },
  { codec: 'vp09.00.10.08', muxer: 'vp9' },
] as const;

const WEBM_CANDIDATES = [
  { codec: 'vp09.00.10.08', muxer: 'V_VP9' },
  { codec: 'vp8', muxer: 'V_VP8' },
  { codec: 'av01.0.04M.08', muxer: 'V_AV1' },
] as const;

interface Codec { codec: string; muxer: string }

async function negotiateCodec(
  format: Exclude<ExportFormat, 'png'>,
  width: number,
  height: number,
): Promise<Codec | null> {
  if (!webCodecsAvailable()) return null;
  const candidates = format === 'mp4' ? MP4_CANDIDATES : WEBM_CANDIDATES;
  for (const candidate of candidates) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec: candidate.codec,
        width: even(width),
        height: even(height),
        bitrate: 8_000_000,
      });
      if (support.supported) return candidate;
    } catch {
      // An unknown codec string throws rather than reporting unsupported.
    }
  }
  return null;
}

export async function isFormatSupported(format: ExportFormat, width: number, height: number) {
  if (format === 'png') return true;
  return (await negotiateCodec(format, width, height)) !== null;
}

const CODEC_LABELS: Record<string, string> = {
  avc: 'H.264',
  av1: 'AV1',
  vp9: 'VP9',
  V_VP9: 'VP9',
  V_VP8: 'VP8',
  V_AV1: 'AV1',
};

export function codecLabel(muxer: string): string {
  return CODEC_LABELS[muxer] ?? muxer;
}

/** Which codec an export would use, so the UI can say so before it runs. */
export async function plannedCodec(
  format: ExportFormat, width: number, height: number,
): Promise<string | null> {
  if (format === 'png') return 'PNG';
  const chosen = await negotiateCodec(format, width, height);
  return chosen ? codecLabel(chosen.muxer) : null;
}

function even(value: number): number {
  // H.264 wants even dimensions; rounding down never overflows the frame.
  return Math.max(2, Math.floor(value / 2) * 2);
}

interface ExportContext {
  project: Project;
  comp: Composition;
  settings: ExportSettings;
  onProgress?: (progress: ExportProgress) => void;
  signal?: { cancelled: boolean };
}

export async function exportComposition(context: ExportContext): Promise<ExportResult> {
  const { project, comp, settings } = context;
  const width = even(Math.round(comp.width * settings.scale));
  const height = even(Math.round(comp.height * settings.scale));

  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!ctx) throw new Error('Could not create a rendering context for export.');

  const start = settings.range === 'workArea' ? comp.workAreaStart : 0;
  const end = settings.range === 'workArea' ? comp.workAreaEnd : comp.duration;
  const total = Math.max(1, Math.round((end - start) * comp.frameRate));

  // Expressions resolve layers by name, so point them at what we are rendering.
  setExpressionContext(project, comp);
  const resolveComposition = (id: Id) => project.compositions.find((c) => c.id === id);
  const renderFrame = async (frame: number) => {
    const time = start + frame / comp.frameRate;
    // Unlike the viewer, export cannot draw a stale video frame and repaint
    // later: every seek has to land before the frame is encoded.
    await prepareFootageForTime(comp, time, resolveComposition);
    renderComposition(ctx, comp, time, {
      // renderComposition divides by resolution, so this is the inverse scale.
      resolution: 1 / settings.scale,
      showTransparencyGrid: false,
      resolveComposition,
    });
  };

  const name = comp.name.replace(/[^\w.-]+/g, '-').toLowerCase();

  const releaseFootageControl = beginExclusiveFootage();
  try {
    if (settings.format === 'png') {
      return await exportPngSequence(context, canvas, renderFrame, total, name);
    }
    return await exportVideo(context, canvas, renderFrame, total, width, height, name);
  } finally {
    releaseFootageControl();
  }
}

async function exportPngSequence(
  { settings, onProgress, signal }: ExportContext,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  renderFrame: (frame: number) => Promise<void>,
  total: number,
  name: string,
): Promise<ExportResult> {
  const zip = new ZipWriter();
  const digits = String(total).length;

  for (let frame = 0; frame < total; frame += 1) {
    if (signal?.cancelled) throw new Error('Export cancelled.');
    await renderFrame(frame);
    const blob = await toBlob(canvas, 'image/png');
    zip.add(
      `${name}_${String(frame).padStart(digits, '0')}.png`,
      new Uint8Array(await blob.arrayBuffer()),
    );
    onProgress?.({ frame: frame + 1, total, stage: 'rendering' });
    // Yield so the progress bar can actually paint.
    if (frame % 4 === 0) await nextTick();
  }

  onProgress?.({ frame: total, total, stage: 'finishing' });
  void settings;
  return { blob: zip.finish(), filename: `${name}-frames.zip`, frames: total, codec: 'PNG' };
}

async function exportVideo(
  { comp, settings, onProgress, signal }: ExportContext,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  renderFrame: (frame: number) => Promise<void>,
  total: number,
  width: number,
  height: number,
  name: string,
): Promise<ExportResult> {
  if (!webCodecsAvailable()) {
    throw new Error('This browser has no WebCodecs encoder. Export a PNG sequence instead.');
  }

  const mp4 = settings.format === 'mp4';
  const chosen = await negotiateCodec(settings.format as 'mp4' | 'webm', width, height);
  if (!chosen) {
    throw new Error(
      `This browser has no encoder for ${mp4 ? 'MP4' : 'WebM'}. Export a PNG sequence instead.`,
    );
  }

  const muxer = mp4
    ? new Mp4Muxer({
      target: new Mp4Target(),
      video: { codec: chosen.muxer as 'avc' | 'av1' | 'vp9', width, height },
      fastStart: 'in-memory',
    })
    : new WebmMuxer({
      target: new WebmTarget(),
      video: {
        codec: chosen.muxer as 'V_VP9' | 'V_VP8' | 'V_AV1',
        width,
        height,
        frameRate: comp.frameRate,
      },
    });

  let encodeError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta as never),
    error: (error) => { encodeError = error; },
  });

  encoder.configure({
    codec: chosen.codec,
    width,
    height,
    bitrate: settings.bitrate,
    framerate: comp.frameRate,
  });

  const frameDuration = 1_000_000 / comp.frameRate;
  for (let frame = 0; frame < total; frame += 1) {
    if (signal?.cancelled) {
      encoder.close();
      throw new Error('Export cancelled.');
    }
    if (encodeError) throw encodeError;

    await renderFrame(frame);
    const videoFrame = new VideoFrame(canvas as CanvasImageSource, {
      timestamp: Math.round(frame * frameDuration),
      duration: Math.round(frameDuration),
    });
    // A keyframe every second keeps the file seekable.
    encoder.encode(videoFrame, { keyFrame: frame % Math.round(comp.frameRate) === 0 });
    videoFrame.close();

    onProgress?.({ frame: frame + 1, total, stage: 'encoding' });

    // Let the encoder drain rather than queueing the whole composition.
    while (encoder.encodeQueueSize > 8) await nextTick();
    if (frame % 4 === 0) await nextTick();
  }

  onProgress?.({ frame: total, total, stage: 'finishing' });
  await encoder.flush();
  encoder.close();
  if (encodeError) throw encodeError;

  muxer.finalize();
  const target = muxer.target as { buffer: ArrayBuffer };
  return {
    blob: new Blob([target.buffer], { type: mp4 ? 'video/mp4' : 'video/webm' }),
    filename: `${name}.${mp4 ? 'mp4' : 'webm'}`,
    frames: total,
    codec: codecLabel(chosen.muxer),
  };
}

async function toBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  type: string,
): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type });
  return new Promise((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the frame.'))),
      type,
    );
  });
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0); });
}
