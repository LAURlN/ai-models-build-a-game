/** Grid helpers shared by the simulation and the renderer. Sized for big maps (typed arrays, heap Dijkstra). */
import type { Coord, MapState, TileData } from './types';

export const BLOCKED = 99;
const DIRS: readonly (readonly [number, number])[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

export const manhattan = (a: Coord, b: Coord): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export const sameCoord = (a: Coord, b: Coord): boolean => a.x === b.x && a.y === b.y;
export const inBounds = (map: MapState, x: number, y: number): boolean =>
  Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < map.width && y < map.height;
export const indexOf = (map: MapState, x: number, y: number): number => y * map.width + x;
export const coordOf = (map: MapState, index: number): Coord => ({ x: index % map.width, y: Math.floor(index / map.width) });

const FALLBACK_TILE: TileData = {
  id: 'void', name: 'Void', cost: BLOCKED, blocksMove: true, blocksSight: true, defense: 0, avoid: 0, look: 'void', tags: [], description: '',
};

export function tileIdAt(map: MapState, x: number, y: number): string {
  if (!inBounds(map, x, y)) return 'void';
  return map.palette[map.cells[y * map.width + x] ?? 0] ?? 'void';
}

export function tileAt(map: MapState, x: number, y: number): TileData {
  return map.defs[tileIdAt(map, x, y)] ?? FALLBACK_TILE;
}

export function setTile(map: MapState, x: number, y: number, tileId: string, def?: TileData): void {
  if (!inBounds(map, x, y)) return;
  let index = map.palette.indexOf(tileId);
  if (index < 0) { map.palette.push(tileId); index = map.palette.length - 1; }
  if (def && !map.defs[tileId]) map.defs[tileId] = def;
  map.cells[y * map.width + x] = index;
}

export function baseTileCost(tile: TileData, moveType: string): number {
  if (tile.costs && typeof tile.costs[moveType] === 'number') return tile.costs[moveType]!;
  return tile.blocksMove ? BLOCKED : tile.cost;
}

/** Supercover line of sight; a diagonal squeezing between two blockers is blocked in both directions. */
export function lineOfSight(map: MapState, a: Coord, b: Coord): boolean {
  const dx = b.x - a.x, dy = b.y - a.y, nx = Math.abs(dx), ny = Math.abs(dy), sx = Math.sign(dx), sy = Math.sign(dy);
  let x = a.x, y = a.y, ix = 0, iy = 0;
  const blocked = (tx: number, ty: number): boolean => (tx === b.x && ty === b.y ? false : tileAt(map, tx, ty).blocksSight);
  while (ix < nx || iy < ny) {
    const decision = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx;
    if (decision === 0) {
      if (blocked(x + sx, y) && blocked(x, y + sy)) return false;
      x += sx; y += sy; ix++; iy++;
    } else if (decision < 0) { x += sx; ix++; } else { y += sy; iy++; }
    if (blocked(x, y)) return false;
  }
  return true;
}

export function lineCells(a: Coord, b: Coord): Coord[] {
  const out: Coord[] = [];
  let x = a.x, y = a.y;
  const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y), sx = a.x < b.x ? 1 : -1, sy = a.y < b.y ? 1 : -1;
  let err = dx - dy;
  for (let guard = 0; guard < 4096; guard++) {
    out.push({ x, y });
    if (x === b.x && y === b.y) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
  return out;
}

/** Cells within Manhattan distance [min, max] of a centre, clipped to the map. */
export function ringCells(map: MapState, centre: Coord, min: number, max: number): Coord[] {
  const out: Coord[] = [];
  for (let dy = -max; dy <= max; dy++) {
    const span = max - Math.abs(dy);
    for (let dx = -span; dx <= span; dx++) {
      const d = Math.abs(dx) + Math.abs(dy);
      if (d < min) continue;
      const x = centre.x + dx, y = centre.y + dy;
      if (x >= 0 && y >= 0 && x < map.width && y < map.height) out.push({ x, y });
    }
  }
  return out;
}

export interface PathField {
  width: number;
  /** Cost to reach each cell; Infinity when unreachable within the budget. */
  dist: Float64Array;
  prev: Int32Array;
  start: number;
}

class MinHeap {
  private readonly keys: number[] = [];
  private readonly values: number[] = [];
  private readonly order: number[] = [];
  private seq = 0;
  get size(): number { return this.keys.length; }
  push(key: number, value: number): void {
    let i = this.keys.length;
    this.keys.push(key); this.values.push(value); this.order.push(this.seq++);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent); i = parent;
    }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.keys[0]!, this.values[0]!];
    const last = this.keys.length - 1;
    this.swap(0, last);
    this.keys.pop(); this.values.pop(); this.order.pop();
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let best = i;
      if (l < this.keys.length && this.less(l, best)) best = l;
      if (r < this.keys.length && this.less(r, best)) best = r;
      if (best === i) break;
      this.swap(i, best); i = best;
    }
    return top;
  }
  private less(a: number, b: number): boolean {
    return this.keys[a]! < this.keys[b]! || (this.keys[a] === this.keys[b] && this.order[a]! < this.order[b]!);
  }
  private swap(a: number, b: number): void {
    const k = this.keys[a]!, v = this.values[a]!, o = this.order[a]!;
    this.keys[a] = this.keys[b]!; this.values[a] = this.values[b]!; this.order[a] = this.order[b]!;
    this.keys[b] = k; this.values[b] = v; this.order[b] = o;
  }
}

/**
 * Dijkstra over the 4-neighbour grid. `enterCost(index)` returns the cost of stepping
 * onto a cell (>= BLOCKED means impassable). Deterministic N/E/S/W tie-breaking.
 */
export function pathField(map: MapState, start: Coord, budget: number, enterCost: (index: number, x: number, y: number) => number): PathField {
  const size = map.width * map.height;
  const dist = new Float64Array(size).fill(Infinity);
  const prev = new Int32Array(size).fill(-1);
  const startIndex = start.y * map.width + start.x;
  dist[startIndex] = 0;
  const heap = new MinHeap();
  heap.push(0, startIndex);
  while (heap.size) {
    const [cost, index] = heap.pop();
    if (cost !== dist[index]) continue;
    const x = index % map.width, y = (index - x) / map.width;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const next = ny * map.width + nx;
      const step = enterCost(next, nx, ny);
      if (!(step < BLOCKED)) continue;
      const total = cost + Math.max(0, step);
      if (total > budget || total >= dist[next]!) continue;
      dist[next] = total; prev[next] = index;
      heap.push(total, next);
    }
  }
  return { width: map.width, dist, prev, start: startIndex };
}

export function pathTo(field: PathField, target: Coord): Coord[] {
  let index = target.y * field.width + target.x;
  if (!Number.isFinite(field.dist[index] ?? Infinity)) return [];
  const out: Coord[] = [];
  for (let guard = 0; index >= 0 && guard < field.dist.length; guard++) {
    out.push({ x: index % field.width, y: Math.floor(index / field.width) });
    if (index === field.start) break;
    index = field.prev[index]!;
  }
  return out.reverse();
}

/** Nearest free cell to a wanted position (spiral by distance, deterministic). */
export function nearestFree(map: MapState, wanted: Coord, isFree: (x: number, y: number) => boolean): Coord | null {
  const cx = Math.max(0, Math.min(map.width - 1, Math.round(wanted.x))), cy = Math.max(0, Math.min(map.height - 1, Math.round(wanted.y)));
  const limit = map.width + map.height;
  for (let d = 0; d <= limit; d++) {
    for (let dy = -d; dy <= d; dy++) {
      const span = d - Math.abs(dy);
      for (const dx of span === 0 ? [0] : [-span, span]) {
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && y >= 0 && x < map.width && y < map.height && isFree(x, y)) return { x, y };
      }
    }
  }
  return null;
}

/** Cells covered by an area shape anchored at `centre`, oriented away from `origin` where relevant. */
export function areaCells(map: MapState, shape: string, size: number, centre: Coord, origin: Coord): Coord[] {
  if (shape === 'all') {
    const out: Coord[] = [];
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) out.push({ x, y });
    return out;
  }
  if (shape === 'burst') return ringCells(map, centre, 0, size);
  const dx = Math.sign(centre.x - origin.x), dy = Math.sign(centre.y - origin.y);
  const dir: [number, number] = Math.abs(centre.x - origin.x) >= Math.abs(centre.y - origin.y) ? [dx || 1, 0] : [0, dy || 1];
  const out: Coord[] = [];
  const add = (x: number, y: number): void => { if (inBounds(map, x, y) && !out.some((c) => c.x === x && c.y === y)) out.push({ x, y }); };
  if (shape === 'cross') {
    add(centre.x, centre.y);
    for (let i = 1; i <= size; i++) for (const [ax, ay] of DIRS) add(centre.x + ax * i, centre.y + ay * i);
  } else if (shape === 'line') {
    for (let i = 0; i < Math.max(1, size); i++) add(centre.x + dir[0] * i, centre.y + dir[1] * i);
  } else if (shape === 'cone') {
    for (let i = 0; i < Math.max(1, size); i++) for (let w = -i; w <= i; w++) add(centre.x + dir[0] * i + (dir[0] === 0 ? w : 0), centre.y + dir[1] * i + (dir[1] === 0 ? w : 0));
  }
  return out;
}
