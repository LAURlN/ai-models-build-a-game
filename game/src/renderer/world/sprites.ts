/**
 * Procedural body plans. Each plan is a list of primitives in a unit square (−1…1),
 * rendered both as SVG (portraits, panels) and with Pixi (board tokens). Colours come
 * from the unit's sprite spec or a stable hash of its identity — never from images.
 */
import { artSeed } from '../presentation';
import type { Loose } from '../../engine/types';

export type Prim =
  | { k: 'circle'; x: number; y: number; r: number; fill: string; stroke?: string; w?: number }
  | { k: 'ellipse'; x: number; y: number; rx: number; ry: number; fill: string; stroke?: string; w?: number }
  | { k: 'poly'; pts: number[]; fill: string; stroke?: string; w?: number }
  | { k: 'line'; pts: number[]; stroke: string; w: number };

export const INK = '#243c3b';
const CREAM = '#fff2d4';

const PALETTE = ['#23657a', '#9e4536', '#7d6a2c', '#5b4a7a', '#3f7a4f', '#8a4a6b', '#6d7d74', '#b0703a', '#3f5f8a'];
export const BODIES = ['humanoid', 'beast', 'bird', 'serpent', 'blob', 'construct', 'machine', 'spirit', 'plant', 'swarm'] as const;

export function hexToNumber(hex: string | undefined, fallback: number): number {
  if (typeof hex !== 'string') return fallback;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return fallback;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  return parseInt(h, 16);
}
const toHex = (n: number): string => `#${(n >>> 0).toString(16).padStart(6, '0').slice(-6)}`;

export interface SpriteColors { primary: string; secondary: string; accent: string; body: string; scale: number }
export function spriteColors(unit: Loose): SpriteColors {
  const sprite = unit?.sprite ?? {};
  const seed = artSeed(String(unit?.classId ?? unit?.template ?? unit?.name ?? 'unit'));
  const tags: string[] = Array.isArray(unit?.tags) ? unit.tags : [];
  const guess = tags.includes('beast') || tags.includes('creature') ? 'beast' : tags.includes('machine') ? 'machine' : tags.includes('plant') ? 'plant' : 'humanoid';
  const color = (v: unknown): string | null => (typeof v === 'string' && /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim()) ? toHex(hexToNumber(v, 0)) : null);
  return {
    primary: color(sprite.primary) ?? PALETTE[seed % PALETTE.length]!,
    secondary: color(sprite.secondary) ?? ['#e9dfc5', '#d7dccb', '#c9b48c', '#c3c5a4'][(seed >>> 4) % 4]!,
    accent: color(sprite.accent) ?? '#c4a15d',
    body: BODIES.includes(sprite.body) ? sprite.body : guess,
    scale: typeof sprite.scale === 'number' && Number.isFinite(sprite.scale) ? Math.max(0.5, Math.min(1.6, sprite.scale)) : 1,
  };
}

/** Primitives for a body plan, centred at 0,0 within roughly ±0.8. */
export function bodyPrims(unit: Loose): Prim[] {
  const c = spriteColors(unit), p = c.primary, s = c.secondary, a = c.accent;
  const variant = artSeed(String(unit?.id ?? unit?.name ?? '')) % 3;
  switch (c.body) {
    case 'beast': return [
      { k: 'ellipse', x: 0.05, y: 0.15, rx: 0.55, ry: 0.3, fill: p, stroke: INK, w: 1 },
      { k: 'line', pts: [-0.35, 0.35, -0.38, 0.62], stroke: INK, w: 2.2 }, { k: 'line', pts: [0.4, 0.35, 0.42, 0.62], stroke: INK, w: 2.2 },
      { k: 'circle', x: -0.48, y: -0.12, r: 0.28, fill: p, stroke: INK, w: 1 },
      { k: 'poly', pts: [-0.62, -0.32, -0.55, -0.62, -0.42, -0.34], fill: p, stroke: INK, w: 1 },
      { k: 'poly', pts: [-0.38, -0.34, -0.26, -0.6, -0.2, -0.28], fill: p, stroke: INK, w: 1 },
      { k: 'ellipse', x: -0.68, y: -0.05, rx: 0.12, ry: 0.08, fill: s },
      { k: 'circle', x: -0.5, y: -0.17, r: 0.04, fill: INK },
      { k: 'line', pts: [0.58, 0.05, 0.82, variant === 0 ? -0.3 : -0.1], stroke: p, w: 3 },
      { k: 'ellipse', x: 0.1, y: 0.25, rx: 0.3, ry: 0.12, fill: s },
    ];
    case 'bird': return [
      { k: 'ellipse', x: 0, y: 0.1, rx: 0.32, ry: 0.4, fill: p, stroke: INK, w: 1 },
      { k: 'poly', pts: [-0.25, -0.05, -0.85, -0.35, -0.7, 0.05, -0.25, 0.25], fill: s, stroke: INK, w: 1 },
      { k: 'poly', pts: [0.25, -0.05, 0.85, -0.35, 0.7, 0.05, 0.25, 0.25], fill: s, stroke: INK, w: 1 },
      { k: 'circle', x: 0, y: -0.38, r: 0.2, fill: p, stroke: INK, w: 1 },
      { k: 'poly', pts: [-0.05, -0.36, 0.05, -0.36, 0, -0.18], fill: a },
      { k: 'circle', x: -0.07, y: -0.42, r: 0.035, fill: INK }, { k: 'circle', x: 0.07, y: -0.42, r: 0.035, fill: INK },
      { k: 'poly', pts: [-0.12, 0.45, 0, 0.75, 0.12, 0.45], fill: s, stroke: INK, w: 1 },
    ];
    case 'serpent': return [
      { k: 'line', pts: [0.65, 0.5, 0.3, 0.55, 0, 0.4, -0.2, 0.15, 0, -0.1, 0.25, -0.25], stroke: INK, w: 7 },
      { k: 'line', pts: [0.65, 0.5, 0.3, 0.55, 0, 0.4, -0.2, 0.15, 0, -0.1, 0.25, -0.25], stroke: p, w: 5 },
      { k: 'ellipse', x: 0.3, y: -0.38, rx: 0.24, ry: 0.17, fill: p, stroke: INK, w: 1 },
      { k: 'poly', pts: [0.08, -0.5, -0.1, -0.7, 0.05, -0.45], fill: s, stroke: INK, w: 0.8 },
      { k: 'circle', x: 0.38, y: -0.42, r: 0.04, fill: INK },
      { k: 'line', pts: [0.52, -0.36, 0.7, -0.32], stroke: a, w: 1.5 },
    ];
    case 'blob': return [
      { k: 'ellipse', x: 0, y: 0.18, rx: 0.62, ry: 0.48, fill: p, stroke: INK, w: 1 },
      { k: 'ellipse', x: -0.15, y: -0.02, rx: 0.2, ry: 0.12, fill: s },
      { k: 'circle', x: -0.2, y: 0.1, r: 0.06, fill: INK }, { k: 'circle', x: 0.2, y: 0.1, r: 0.06, fill: INK },
      { k: 'circle', x: 0.35, y: -0.25, r: variant ? 0.1 : 0.14, fill: s, stroke: INK, w: 0.8 },
      { k: 'circle', x: -0.4, y: -0.18, r: 0.08, fill: s, stroke: INK, w: 0.8 },
    ];
    case 'construct': return [
      { k: 'poly', pts: [-0.45, -0.45, 0.45, -0.45, 0.55, 0.45, -0.55, 0.45], fill: p, stroke: INK, w: 1.2 },
      { k: 'poly', pts: [-0.28, -0.75, 0.28, -0.75, 0.32, -0.42, -0.32, -0.42], fill: s, stroke: INK, w: 1 },
      { k: 'line', pts: [-0.45, 0, 0.5, 0], stroke: INK, w: 1 },
      { k: 'circle', x: -0.12, y: -0.6, r: 0.05, fill: a }, { k: 'circle', x: 0.12, y: -0.6, r: 0.05, fill: a },
      { k: 'poly', pts: [-0.85, -0.3, -0.5, -0.4, -0.55, 0.2, -0.85, 0.1], fill: s, stroke: INK, w: 1 },
      { k: 'poly', pts: [0.85, -0.3, 0.5, -0.4, 0.55, 0.2, 0.85, 0.1], fill: s, stroke: INK, w: 1 },
    ];
    case 'machine': return [
      { k: 'circle', x: 0, y: 0, r: 0.45, fill: p, stroke: INK, w: 1.2 },
      { k: 'circle', x: 0, y: 0, r: 0.2, fill: s, stroke: INK, w: 1 },
      { k: 'circle', x: 0, y: 0, r: 0.08, fill: a },
      { k: 'line', pts: [-0.75, -0.55, -0.3, -0.3], stroke: INK, w: 2 }, { k: 'line', pts: [0.75, -0.55, 0.3, -0.3], stroke: INK, w: 2 },
      { k: 'ellipse', x: -0.78, y: -0.58, rx: 0.16, ry: 0.05, fill: s, stroke: INK, w: 0.8 }, { k: 'ellipse', x: 0.78, y: -0.58, rx: 0.16, ry: 0.05, fill: s, stroke: INK, w: 0.8 },
      { k: 'line', pts: [0, 0.45, 0, 0.75], stroke: INK, w: 2 },
    ];
    case 'spirit': return [
      { k: 'poly', pts: [0, -0.75, 0.45, -0.2, 0.4, 0.4, 0.2, 0.25, 0, 0.7, -0.2, 0.25, -0.4, 0.4, -0.45, -0.2], fill: p, stroke: s, w: 1.5 },
      { k: 'circle', x: -0.14, y: -0.22, r: 0.07, fill: CREAM }, { k: 'circle', x: 0.14, y: -0.22, r: 0.07, fill: CREAM },
      { k: 'circle', x: 0, y: 0.1, r: 0.12, fill: a },
    ];
    case 'plant': return [
      { k: 'line', pts: [0, 0.75, 0, -0.1], stroke: '#5d6650', w: 3 },
      { k: 'poly', pts: [0, 0.2, -0.6, -0.05, -0.2, 0.35], fill: s, stroke: INK, w: 0.8 },
      { k: 'poly', pts: [0, 0.05, 0.6, -0.2, 0.25, 0.25], fill: s, stroke: INK, w: 0.8 },
      { k: 'circle', x: 0, y: -0.35, r: 0.33, fill: p, stroke: INK, w: 1 },
      { k: 'circle', x: 0, y: -0.35, r: 0.12, fill: a },
    ];
    case 'swarm': return [0, 1, 2, 3, 4, 5].map((i) => ({ k: 'circle' as const, x: Math.cos(i * 1.7 + variant) * 0.45, y: Math.sin(i * 2.3 + variant) * 0.45, r: 0.15 + (i % 2) * 0.05, fill: i % 2 ? p : s, stroke: INK, w: 0.8 }));
    default: { // humanoid
      const helm = variant;
      return [
        { k: 'poly', pts: [-0.5, 0.75, -0.42, 0.05, 0.42, 0.05, 0.5, 0.75], fill: p, stroke: INK, w: 1 },
        { k: 'poly', pts: [-0.42, 0.05, 0, 0.3, 0.42, 0.05, 0.3, 0.75, -0.3, 0.75], fill: s, stroke: INK, w: 0.6 },
        { k: 'circle', x: 0, y: -0.3, r: 0.3, fill: '#e2c09b', stroke: INK, w: 1 },
        helm === 0 ? { k: 'poly', pts: [-0.33, -0.36, -0.22, -0.66, 0.22, -0.66, 0.33, -0.36, 0, -0.48], fill: s, stroke: INK, w: 1 }
          : helm === 1 ? { k: 'poly', pts: [-0.34, -0.3, -0.1, -0.78, 0.34, -0.3, 0.1, -0.45], fill: p, stroke: INK, w: 1 }
            : { k: 'poly', pts: [-0.3, -0.42, -0.28, -0.62, 0, -0.68, 0.28, -0.62, 0.3, -0.42, 0, -0.5], fill: '#4b3a2c' },
        { k: 'circle', x: -0.1, y: -0.3, r: 0.035, fill: INK }, { k: 'circle', x: 0.1, y: -0.3, r: 0.035, fill: INK },
        { k: 'circle', x: 0, y: 0.25, r: 0.06, fill: a },
      ];
    }
  }
}

const f = (n: number): string => n.toFixed(2);
/** SVG markup for a body plan (no user-supplied strings are interpolated except validated colours). */
export function bodySvg(unit: Loose, size = 48): string {
  const prims = bodyPrims(unit), c = spriteColors(unit);
  const scale = 20 * c.scale;
  const shapes = prims.map((p) => {
    const stroke = 'stroke' in p && p.stroke ? ` stroke="${p.stroke}" stroke-width="${(p.w ?? 1) * 0.8}"` : '';
    switch (p.k) {
      case 'circle': return `<circle cx="${f(p.x * scale)}" cy="${f(p.y * scale)}" r="${f(p.r * scale)}" fill="${p.fill}"${stroke}/>`;
      case 'ellipse': return `<ellipse cx="${f(p.x * scale)}" cy="${f(p.y * scale)}" rx="${f(p.rx * scale)}" ry="${f(p.ry * scale)}" fill="${p.fill}"${stroke}/>`;
      case 'poly': return `<polygon points="${p.pts.map((n) => f(n * scale)).join(' ')}" fill="${p.fill}"${stroke} stroke-linejoin="round"/>`;
      case 'line': return `<polyline points="${p.pts.map((n) => f(n * scale)).join(' ')}" fill="none" stroke="${p.stroke}" stroke-width="${p.w * 0.8}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
  }).join('');
  return `<svg viewBox="-24 -24 48 48" width="${size}" height="${size}" aria-hidden="true"><circle r="23" fill="#243c3b" stroke="#c4a15d" stroke-width="1.5"/><circle r="20" fill="#c3c5a4"/>${shapes}</svg>`;
}

/** Validated colour strings only (prims colours come from spriteColors or constants). */
export function safeColor(value: string): string { return /^#[0-9a-f]{3,8}$/i.test(value) ? value : toHex(hexToNumber(value, 0x888888)); }

export interface GraphicsLike {
  circle(x: number, y: number, r: number): GraphicsLike;
  ellipse(x: number, y: number, rx: number, ry: number): GraphicsLike;
  poly(points: number[], close?: boolean): GraphicsLike;
  moveTo(x: number, y: number): GraphicsLike;
  lineTo(x: number, y: number): GraphicsLike;
  fill(style: Loose): GraphicsLike;
  stroke(style: Loose): GraphicsLike;
}

/** Draws a body plan into a Pixi Graphics at the origin with the given radius in pixels. */
export function drawBody(g: GraphicsLike, unit: Loose, radius: number): void {
  const scale = radius * spriteColors(unit).scale;
  for (const p of bodyPrims(unit)) {
    const stroke = 'stroke' in p && p.stroke ? { color: hexToNumber(p.stroke, 0x243c3b), width: (p.w ?? 1) * Math.max(0.6, radius / 22) } : null;
    if (p.k === 'line') {
      g.moveTo(p.pts[0]! * scale, p.pts[1]! * scale);
      for (let i = 2; i < p.pts.length; i += 2) g.lineTo(p.pts[i]! * scale, p.pts[i + 1]! * scale);
      g.stroke({ color: hexToNumber(p.stroke, 0x243c3b), width: p.w * Math.max(0.6, radius / 22), cap: 'round', join: 'round' });
      continue;
    }
    if (p.k === 'circle') g.circle(p.x * scale, p.y * scale, p.r * scale);
    else if (p.k === 'ellipse') g.ellipse(p.x * scale, p.y * scale, p.rx * scale, p.ry * scale);
    else g.poly(p.pts.map((n) => n * scale));
    g.fill(hexToNumber(p.fill, 0x888888));
    if (stroke) g.stroke(stroke);
  }
}
