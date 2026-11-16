/** Procedural maps of any size: built-in generators, explicit rows, stamps and module generators. */
import { mix32, seededRng, type Rng } from './rng';
import { invoke, normalizeTile, type Registry } from './registry';
import type { Loose, MapState, TileData } from './types';

const tile = (id: string, look: string, extra: Partial<TileData> = {}): TileData => ({
  id, name: extra.name ?? id.replace(/-/g, ' '), cost: 1, blocksMove: false, blocksSight: false, defense: 0, avoid: 0,
  look, tags: [], description: '', ...extra,
});

/** Neutral terrain vocabulary available to every battle. Modules add or override freely. */
export const CORE_TILES: Record<string, TileData> = {
  plain: tile('plain', 'plain', { description: 'Open ground.' }),
  grass: tile('grass', 'grass', { description: 'Open ground.' }),
  'tall-grass': tile('tall-grass', 'tallgrass', { name: 'tall grass', avoid: 10, description: '+10 avoid.' }),
  forest: tile('forest', 'forest', { cost: 2, defense: 1, avoid: 20, description: 'Costs 2 movement. +1 defense, +20 avoid.' }),
  thicket: tile('thicket', 'forest', { cost: 3, defense: 2, avoid: 30, blocksSight: true, description: 'Costs 3 movement, blocks sight.' }),
  water: tile('water', 'water', { cost: 3, avoid: -10, costs: { fly: 1, swim: 1 }, description: 'Costs 3 movement, −10 avoid.' }),
  'deep-water': tile('deep-water', 'deepwater', { name: 'deep water', blocksMove: true, cost: 99, costs: { fly: 1, swim: 1 }, description: 'Impassable on foot.' }),
  wall: tile('wall', 'wall', { blocksMove: true, blocksSight: true, cost: 99, description: 'Impassable, blocks sight.' }),
  rock: tile('rock', 'rock', { blocksMove: true, blocksSight: true, cost: 99, costs: { fly: 1 }, description: 'Impassable, blocks sight.' }),
  sand: tile('sand', 'sand', { cost: 2, description: 'Costs 2 movement.' }),
  road: tile('road', 'road', { description: 'Easy going.' }),
  floor: tile('floor', 'floor', { description: 'Worked floor.' }),
  mud: tile('mud', 'mud', { cost: 2, avoid: -10, description: 'Costs 2 movement, −10 avoid.' }),
  snow: tile('snow', 'snow', { cost: 2, description: 'Costs 2 movement.' }),
  ice: tile('ice', 'ice', { avoid: -15, description: '−15 avoid.' }),
  rubble: tile('rubble', 'rubble', { cost: 2, defense: 1, description: 'Costs 2 movement, +1 defense.' }),
  bridge: tile('bridge', 'bridge', { description: 'A crossing.' }),
  crop: tile('crop', 'crop', { avoid: 5, description: 'Planted rows.' }),
  fence: tile('fence', 'fence', { blocksMove: true, cost: 99, costs: { fly: 1 }, description: 'Impassable on foot; does not block sight.' }),
  lava: tile('lava', 'lava', { cost: 2, hazard: [{ op: 'damage', amount: 5, type: 'fire' }], description: 'Ending a phase here deals 5 damage.' }),
  metal: tile('metal', 'metal', { description: 'Plating.' }),
  void: tile('void', 'void', { blocksMove: true, blocksSight: false, cost: 99, description: 'Nothing to stand on.' }),
};

const DEFAULT_LEGEND: Record<string, string> = {
  '.': 'plain', ',': 'grass', '"': 'tall-grass', 'f': 'forest', 'T': 'thicket', '~': 'water', 'w': 'deep-water', '#': 'wall',
  'r': 'rock', 's': 'sand', '=': 'road', '_': 'floor', 'm': 'mud', '*': 'snow', 'i': 'ice', 'x': 'rubble', 'b': 'bridge',
  'c': 'crop', '|': 'fence', 'L': 'lava', 'M': 'metal', ' ': 'void',
};

function valueNoise(seed: number, x: number, y: number, scale: number): number {
  const fx = x / scale, fy = y / scale, x0 = Math.floor(fx), y0 = Math.floor(fy);
  const corner = (cx: number, cy: number): number => mix32(seed, Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663)) / 4294967296;
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  const tx = smooth(fx - x0), ty = smooth(fy - y0);
  const top = corner(x0, y0) * (1 - tx) + corner(x0 + 1, y0) * tx;
  const bottom = corner(x0, y0 + 1) * (1 - tx) + corner(x0 + 1, y0 + 1) * tx;
  return top * (1 - ty) + bottom * ty;
}

export interface MapGen {
  width: number;
  height: number;
  rng: Rng;
  seed: number;
  params: Loose;
  get(x: number, y: number): string;
  set(x: number, y: number, tileId: string): void;
  fill(tileId: string): void;
  rect(x: number, y: number, w: number, h: number, tileId: string, hollow?: boolean): void;
  line(x0: number, y0: number, x1: number, y1: number, tileId: string, width?: number): void;
  circle(cx: number, cy: number, radius: number, tileId: string): void;
  scatter(tileId: string, amount: number, only?: string): void;
  /** Organic clumps covering roughly `amount` (0–1) of the map. */
  blobs(tileId: string, amount: number, scale?: number, only?: string): void;
  noise(x: number, y: number, scale?: number, channel?: number): number;
}

function makeGen(width: number, height: number, seed: number, params: Loose, grid: string[]): MapGen {
  const rng = seededRng(seed);
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height;
  const gen: MapGen = {
    width, height, rng, seed, params,
    get: (x, y) => (inside(x, y) ? grid[y * width + x]! : 'void'),
    set: (x, y, id) => { if (inside(Math.round(x), Math.round(y))) grid[Math.round(y) * width + Math.round(x)] = String(id); },
    fill: (id) => { grid.fill(String(id)); },
    rect: (x, y, w, h, id, hollow = false) => {
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
        if (!hollow || yy === y || yy === y + h - 1 || xx === x || xx === x + w - 1) gen.set(xx, yy, id);
      }
    },
    line: (x0, y0, x1, y1, id, lineWidth = 1) => {
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
      for (let i = 0; i <= steps; i++) {
        const x = Math.round(x0 + ((x1 - x0) * i) / steps), y = Math.round(y0 + ((y1 - y0) * i) / steps);
        for (let a = 0; a < lineWidth; a++) for (let b = 0; b < lineWidth; b++) gen.set(x + a - Math.floor(lineWidth / 2), y + b - Math.floor(lineWidth / 2), id);
      }
    },
    circle: (cx, cy, radius, id) => {
      for (let y = Math.floor(cy - radius); y <= cy + radius; y++) for (let x = Math.floor(cx - radius); x <= cx + radius; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius + 0.5) gen.set(x, y, id);
      }
    },
    scatter: (id, amount, only) => {
      for (let i = 0; i < grid.length; i++) if ((!only || grid[i] === only) && rng.next() < amount) grid[i] = String(id);
    },
    blobs: (id, amount, scale = 5, only) => {
      const channel = mix32(seed, [...String(id)].reduce((s, c) => s + c.charCodeAt(0), 7));
      const samples: number[] = [];
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) samples.push(valueNoise(channel, x, y, scale) * 0.75 + valueNoise(channel ^ 0x5bd1e995, x, y, scale / 2.3) * 0.25);
      const sorted = [...samples].sort((a, b) => b - a);
      const threshold = sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * Math.min(1, Math.max(0, amount)))))] ?? 2;
      for (let i = 0; i < grid.length; i++) if (samples[i]! > threshold && (!only || grid[i] === only)) grid[i] = String(id);
    },
    noise: (x, y, scale = 6, channel = 0) => valueNoise(mix32(seed, channel), x, y, scale),
  };
  return gen;
}

type Builtin = (gen: MapGen, base: string, spec: Loose) => void;

const BUILTIN: Record<string, Builtin> = {
  open: (gen, base) => { gen.fill(base); },
  /** Organic outdoors: features: [{ tile, amount, scale }]. */
  wilds: (gen, base, spec) => {
    gen.fill(base);
    const features = Array.isArray(spec.features) && spec.features.length ? spec.features : [
      { tile: 'forest', amount: 0.16, scale: 5 }, { tile: 'tall-grass', amount: 0.14, scale: 4 }, { tile: 'water', amount: 0.05, scale: 7 },
    ];
    for (const f of features) gen.blobs(String(f.tile), Number(f.amount ?? 0.1), Number(f.scale ?? 5), f.only ? String(f.only) : undefined);
  },
  /** Cellular-automata caverns. params: { wall, fill (0–1) }. */
  caves: (gen, base, spec) => {
    const wall = String(spec.params?.wall ?? 'rock'), density = Number(spec.params?.fill ?? 0.42);
    let cells = Array.from({ length: gen.width * gen.height }, () => gen.rng.next() < density);
    const at = (x: number, y: number): boolean => (x < 0 || y < 0 || x >= gen.width || y >= gen.height ? true : cells[y * gen.width + x]!);
    for (let pass = 0; pass < 4; pass++) {
      cells = cells.map((_, i) => {
        const x = i % gen.width, y = Math.floor(i / gen.width);
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && at(x + dx, y + dy)) n++;
        return n >= 5;
      });
    }
    for (let i = 0; i < cells.length; i++) gen.set(i % gen.width, Math.floor(i / gen.width), cells[i] ? wall : base);
  },
  /** Rooms joined by corridors. params: { wall, rooms }. */
  rooms: (gen, base, spec) => {
    const wall = String(spec.params?.wall ?? 'wall');
    gen.fill(wall);
    const count = Math.max(2, Math.round(Number(spec.params?.rooms ?? Math.max(4, (gen.width * gen.height) / 110))));
    let last: [number, number] | null = null;
    for (let i = 0; i < count; i++) {
      const w = gen.rng.range(4, Math.max(5, Math.floor(gen.width / 4))), h = gen.rng.range(3, Math.max(4, Math.floor(gen.height / 4)));
      const x = gen.rng.range(1, Math.max(1, gen.width - w - 1)), y = gen.rng.range(1, Math.max(1, gen.height - h - 1));
      gen.rect(x, y, w, h, base);
      const centre: [number, number] = [x + Math.floor(w / 2), y + Math.floor(h / 2)];
      if (last) { gen.line(last[0], last[1], centre[0], last[1], base, 2); gen.line(centre[0], last[1], centre[0], centre[1], base, 2); }
      last = centre;
    }
  },
  /** City blocks cut by streets. params: { block, street, building, spacing }. */
  streets: (gen, base, spec) => {
    const building = String(spec.params?.building ?? 'wall'), street = String(spec.params?.street ?? 'road');
    const spacing = Math.max(4, Math.round(Number(spec.params?.spacing ?? 7)));
    gen.fill(base);
    for (let by = 1; by < gen.height - 2; by += spacing) for (let bx = 1; bx < gen.width - 2; bx += spacing) {
      const w = gen.rng.range(2, spacing - 2), h = gen.rng.range(2, spacing - 2);
      if (gen.rng.next() < 0.78) gen.rect(bx + gen.rng.int(2), by + gen.rng.int(2), w, h, building);
    }
    for (let y = 0; y < gen.height; y += spacing) gen.line(0, y, gen.width - 1, y, street);
    for (let x = 0; x < gen.width; x += spacing) gen.line(x, 0, x, gen.height - 1, street);
  },
  /** Land ringed by water. params: { water }. */
  islands: (gen, base, spec) => {
    const water = String(spec.params?.water ?? 'deep-water');
    for (let y = 0; y < gen.height; y++) for (let x = 0; x < gen.width; x++) {
      const edge = Math.min(x, y, gen.width - 1 - x, gen.height - 1 - y) / Math.max(1, Math.min(gen.width, gen.height) / 2);
      gen.set(x, y, gen.noise(x, y, 6) * 0.6 + edge * 0.7 > 0.5 ? base : water);
    }
    gen.blobs('forest', 0.1, 4, base);
  },
};

export const BUILTIN_GENERATORS = Object.keys(BUILTIN);

function applyStamps(gen: MapGen, stamps: Loose[]): void {
  for (const s of stamps) {
    if (!s || typeof s !== 'object') continue;
    const id = String(s.tile ?? 'plain');
    if (Array.isArray(s.rect)) gen.rect(Number(s.rect[0]), Number(s.rect[1]), Number(s.rect[2] ?? 1), Number(s.rect[3] ?? 1), id, !!s.hollow);
    if (Array.isArray(s.line)) gen.line(Number(s.line[0]), Number(s.line[1]), Number(s.line[2]), Number(s.line[3]), id, Number(s.width ?? 1));
    if (Array.isArray(s.circle)) gen.circle(Number(s.circle[0]), Number(s.circle[1]), Number(s.circle[2] ?? 1), id);
    if (Array.isArray(s.at)) for (const p of s.at) if (Array.isArray(p)) gen.set(Number(p[0]), Number(p[1]), id);
    if (typeof s.scatter === 'number') gen.scatter(id, s.scatter, s.only ? String(s.only) : undefined);
    if (typeof s.blobs === 'number') gen.blobs(id, s.blobs, Number(s.scale ?? 5), s.only ? String(s.only) : undefined);
  }
}

/**
 * Builds a map from a battle spec's `map` object. There is no size cap; the only
 * guard is a sane floor so a malformed spec still yields a playable board.
 */
export function buildMap(spec: Loose, reg: Registry, seed: number): MapState {
  const m = spec && typeof spec === 'object' ? spec : {};
  const rows: string[] | null = Array.isArray(m.rows) && m.rows.length ? m.rows.map(String) : null;
  const width = Math.max(1, Math.round(Number(rows ? Math.max(...rows.map((r) => r.length)) : m.width ?? 16)) || 16);
  const height = Math.max(1, Math.round(Number(rows ? rows.length : m.height ?? 12)) || 12);
  const base = String(m.base ?? 'plain');
  const grid: string[] = new Array<string>(width * height).fill(base);
  const gen = makeGen(width, height, seed, m.params ?? {}, grid);

  if (rows) {
    const legend: Record<string, string> = { ...DEFAULT_LEGEND, ...(m.legend && typeof m.legend === 'object' ? m.legend : {}) };
    rows.forEach((row, y) => [...row.padEnd(width, row.at(-1) ?? '.')].forEach((ch, x) => gen.set(x, y, String(legend[ch] ?? base))));
  } else {
    const id = String(m.generator ?? 'wilds');
    const custom = reg.generators[id];
    if (custom) {
      const ran = invoke(reg, custom.module, `map generator ${id}`, () => { custom.generate(gen); return true; });
      if (!ran) BUILTIN.wilds!(gen, base, m);
    } else (BUILTIN[id] ?? BUILTIN.wilds!)(gen, base, m);
  }
  if (Array.isArray(m.stamps)) applyStamps(gen, m.stamps);
  if (typeof m.border === 'string') gen.rect(0, 0, width, height, m.border, true);

  const inline: Record<string, TileData> = {};
  if (m.tiles && typeof m.tiles === 'object') for (const [id, raw] of Object.entries(m.tiles)) inline[id] = normalizeTile(raw, id);

  const palette: string[] = [];
  const defs: Record<string, TileData> = {};
  const cells = grid.map((id) => {
    let index = palette.indexOf(id);
    if (index < 0) {
      palette.push(id); index = palette.length - 1;
      const def = inline[id] ?? reg.tiles[id] ?? CORE_TILES[id];
      // Unknown tile ids stay walkable: content mistakes must not brick a battle.
      defs[id] = def ? stripFunctions(def) : tile(id, id);
    }
    return index;
  });
  return { width, height, palette, cells, defs };
}

export function stripFunctions<T extends object>(def: T): T {
  return Object.fromEntries(Object.entries(def).filter(([key, v]) => typeof v !== 'function' && key !== 'module')) as T;
}
