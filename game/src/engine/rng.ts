/**
 * Counter-based deterministic randomness. The whole generator state is `{seed, pos}`
 * stored in the battle/campaign state, so snapshots, saves and the Turnwheel restore
 * the exact random stream without any hidden state.
 */

export function mix32(a: number, b: number): number {
  // Scramble the seed first so nearby seeds do not yield shifted copies of one stream.
  let h = Math.imul((a ^ 0x9e3779b9) >>> 0, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = (h + Math.imul((b + 0x7f4a7c15) | 0, 0xc2b2ae35)) | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x27d4eb2f);
  h ^= h >>> 13;
  h = Math.imul(h, 0x165667b1);
  h ^= h >>> 16;
  return h >>> 0;
}

export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Stable 64-bit-ish content hash of any JSON value (hex). */
export function hashJson(value: unknown): string {
  const json = JSON.stringify(value);
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let i = 0; i < json.length; i++) {
    const c = json.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ (c + i), 0x85ebca6b);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

export interface RngHolder { seed: number; rngPos: number }

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [0, n). */
  int(n: number): number;
  /** Integer in [min, max] inclusive. */
  range(min: number, max: number): number;
  /** True with the given percent chance (0–100). */
  chance(percent: number): boolean;
  pick<T>(list: readonly T[]): T | undefined;
  shuffle<T>(list: readonly T[]): T[];
  /** Weighted pick: entries of [value, weight]. */
  weighted<T>(entries: readonly (readonly [T, number])[]): T | undefined;
}

export function makeRng(holder: RngHolder, forced?: number[]): Rng {
  const next = (): number => {
    const pos = holder.rngPos++;
    if (forced && forced.length) return Math.min(0.999999, Math.max(0, forced.shift()!));
    return mix32(holder.seed >>> 0, pos) / 4294967296;
  };
  const int = (n: number): number => (n <= 1 || !Number.isFinite(n) ? (next(), 0) : Math.floor(next() * Math.floor(n)));
  return {
    next,
    int,
    range: (min, max) => Math.floor(min) + int(Math.floor(max) - Math.floor(min) + 1),
    chance: (percent) => next() * 100 < percent,
    pick: (list) => (list.length ? list[int(list.length)] : undefined),
    shuffle: (list) => {
      const out = [...list];
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(i + 1);
        const tmp = out[i]!; out[i] = out[j]!; out[j] = tmp;
      }
      return out;
    },
    weighted: (entries) => {
      const total = entries.reduce((sum, [, w]) => sum + Math.max(0, w), 0);
      if (total <= 0) return entries[0]?.[0];
      let roll = next() * total;
      for (const [value, weight] of entries) {
        roll -= Math.max(0, weight);
        if (roll < 0) return value;
      }
      return entries.at(-1)?.[0];
    },
  };
}

/** Stateless RNG for presentation / map generation from a fixed seed (does not touch battle state). */
export function seededRng(seed: number): Rng {
  return makeRng({ seed: seed >>> 0, rngPos: 0 });
}
