import { useEffect, useRef } from 'react';
import { samplePreset } from '@/core/easings';
import type { EasingPreset } from '@/core/easings';

interface Props {
  preset: EasingPreset;
  size?: number;
  active?: boolean;
}

/** Small plot of a preset's curve, drawn the way Flow shows its library. */
export function CurveThumb({ preset, size = 30, active = false }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const pad = 5;
    const inner = size - pad * 2;

    ctx.strokeStyle = '#3a3a3a';
    ctx.lineWidth = 1;
    ctx.strokeRect(pad + 0.5, pad + 0.5, inner - 1, inner - 1);

    // Overshooting curves (Back, Elastic) leave the unit box, so squeeze the
    // plot to whatever range the curve actually covers.
    let min = 0;
    let max = 1;
    const samples = 48;
    for (let i = 0; i <= samples; i += 1) {
      const v = samplePreset(preset, i / samples);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    const scale = (v: number) => (v - min) / Math.max(1e-6, max - min);

    ctx.strokeStyle = active ? '#ffd24a' : '#6fa8ff';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i <= samples; i += 1) {
      const t = i / samples;
      const x = pad + t * inner;
      const y = pad + (1 - scale(samplePreset(preset, t))) * inner;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }, [preset, size, active]);

  return <canvas ref={ref} style={{ width: size, height: size, display: 'block' }} />;
}
