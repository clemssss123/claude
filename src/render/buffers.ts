/**
 * Scratch canvases for the compositing pipeline.
 *
 * Masks, track mattes and per-layer blending all need somewhere to draw
 * before the result reaches the frame, and allocating those canvases per
 * frame would thrash. The pool keeps one canvas per slot and resizes only
 * when the composition does.
 */

export interface Buffer {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}

function createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export class BufferPool {
  private buffers = new Map<string, Buffer>();

  private width = 0;

  private height = 0;

  /** Resize every buffer to the frame size; contents are discarded. */
  resize(width: number, height: number): void {
    if (this.width === width && this.height === height) return;
    this.width = width;
    this.height = height;
    for (const buffer of this.buffers.values()) {
      buffer.canvas.width = width;
      buffer.canvas.height = height;
    }
  }

  get(name: string): Buffer {
    const existing = this.buffers.get(name);
    if (existing) return existing;

    const canvas = createCanvas(this.width || 1, this.height || 1);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    if (!ctx) throw new Error('2D canvas context unavailable.');
    const buffer = { canvas, ctx };
    this.buffers.set(name, buffer);
    return buffer;
  }

  /** A cleared buffer with the default compositing state. */
  clear(name: string): Buffer {
    const buffer = this.get(name);
    const { ctx } = buffer;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.clearRect(0, 0, buffer.canvas.width, buffer.canvas.height);
    return buffer;
  }
}
