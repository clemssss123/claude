import { describe, expect, it } from 'vitest';
import { ZipWriter } from '../../render/zip';
import { allEffectDefinitions, createEffectInstance } from '../../render/effects';
import { valueAtTime } from '../property';

describe('zip writer', () => {
  it('writes a readable archive with the right signatures', async () => {
    const zip = new ZipWriter();
    zip.add('frame_000.png', new TextEncoder().encode('first'));
    zip.add('frame_001.png', new TextEncoder().encode('second'));
    const bytes = new Uint8Array(await zip.finish().arrayBuffer());

    const view = new DataView(bytes.buffer);
    // Local file header, then the end-of-central-directory record.
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(bytes.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(bytes.length - 22 + 8, true)).toBe(2);
  });

  it('stores the file contents verbatim', async () => {
    const payload = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const zip = new ZipWriter();
    zip.add('a.png', payload);
    const bytes = new Uint8Array(await zip.finish().arrayBuffer());

    const nameLength = new DataView(bytes.buffer).getUint16(26, true);
    const start = 30 + nameLength;
    expect([...bytes.slice(start, start + payload.length)]).toEqual([...payload]);
  });

  it('records each entry once in the central directory', async () => {
    const zip = new ZipWriter();
    for (let i = 0; i < 5; i += 1) zip.add(`f${i}.png`, new Uint8Array([i]));
    const bytes = new Uint8Array(await zip.finish().arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getUint16(bytes.length - 22 + 10, true)).toBe(5);
  });

  it('produces an empty but valid archive', async () => {
    const bytes = new Uint8Array(await new ZipWriter().finish().arrayBuffer());
    expect(bytes.length).toBe(22);
    expect(new DataView(bytes.buffer).getUint32(0, true)).toBe(0x06054b50);
  });
});

describe('shake and twitch', () => {
  it('ships both effects', () => {
    const names = allEffectDefinitions().map((d) => d.name);
    expect(names).toContain('Shake');
    expect(names).toContain('Twitch');
  });

  it('gives Shake the controls the plugin it is modelled on has', () => {
    const shake = allEffectDefinitions().find((d) => d.name === 'Shake')!;
    const keys = shake.params.map((p) => p.key);
    for (const key of [
      // What the frame does.
      'amplitude', 'positionAmount', 'rotationAmount', 'zoomAmount',
      // How it moves.
      'frequency', 'octaves', 'roughness', 'wander', 'wanderFrequency',
      // What happens at the edges, and in the shutter.
      'edges', 'motionBlur', 'shutterAngle', 'blurSamples',
      'lockX', 'lockY', 'timeOffset', 'seed',
    ]) {
      expect(keys).toContain(key);
    }
  });

  it('gives Twitch its glitch channels', () => {
    const twitch = allEffectDefinitions().find((d) => d.name === 'Twitch')!;
    const keys = twitch.params.map((p) => p.key);
    for (const key of ['amount', 'speed', 'probability', 'slide', 'scaleAmount', 'colourSplit', 'blurAmount', 'seed']) {
      expect(keys).toContain(key);
    }
  });

  it('builds instances with usable defaults', () => {
    for (const name of ['Shake', 'Twitch']) {
      const definition = allEffectDefinitions().find((d) => d.name === name)!;
      const instance = createEffectInstance(definition.matchName)!;
      expect(valueAtTime(instance.params.seed, 0)).toBe(0);
      expect(valueAtTime(instance.params.amount ?? instance.params.amplitude, 0)).toBe(100);
    }
  });

  it('asks for headroom only where it moves the layer', () => {
    const shake = allEffectDefinitions().find((d) => d.name === 'Shake')!;
    expect(shake.margin).toBeDefined();
    const get = (<T,>(key: string): T => {
      const param = shake.params.find((p) => p.key === key);
      return (param?.default ?? 0) as T;
    }) as <T>(key: string) => T;
    expect(shake.margin!(get as never)).toBeGreaterThan(0);
  });
});
