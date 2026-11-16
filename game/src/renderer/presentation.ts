import type { BattleState, Coord, Terrain, UnitState } from '../shared/contracts';

// Presentation randomness is a stateless hash. It never touches the battle PRNG.
export function artSeed(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export const ATLAS = { ink: 0x243c3b, paper: 0xe3d8ba, brass: 0xc4a15d,
  player: 0x23657a, enemy: 0x9e4536, cream: 0xfff2d4, shadow: 0x172e30 };

export function unitRecipe(unit: UnitState) {
  const identity = artSeed(unit.id);
  const role = artSeed(`${unit.classId}/${unit.title}`);
  return {
    identity, role, factionShape: unit.faction === 'player' ? 'shield' : 'diamond',
    factionColor: unit.faction === 'player' ? ATLAS.player : ATLAS.enemy,
    weapon: unit.weapon.tag, helm: role % 4, mantle: (role >>> 4) % 3,
    crest: (role >>> 8) % 5, trim: [0xe8ca83, 0xd5dfcd, 0xe3b09a][(role >>> 12) % 3]!,
    skin: [0xe8c49d, 0xc08c64, 0x865b43, 0xf0d2b4][identity % 4]!,
    hair: [0x342e29, 0x92603d, 0xc2b7a0, 0x512e28][(identity >>> 3) % 4]!,
  } as const;
}

export function terrainRecipe(seed: number, x: number, y: number, terrain: Terrain) {
  const n = artSeed(`${seed}/${x}/${y}/${terrain}`);
  return { seed: n, flecks: 3 + n % 4, variation: n % 3,
    color: terrain === 'wall' ? [0x697976, 0x74817a, 0x5d706c][n % 3]!
      : terrain === 'cover' ? [0x8caa82, 0x9ab08a, 0x91a783][n % 3]!
      : [0xe0d5b7, 0xe5dabc, 0xdccfae][n % 3]! };
}

export const easeOut = (t: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
export function pathPosition(path: readonly Coord[], progress: number): Coord {
  if (!path.length) return { x: 0, y: 0 };
  const at = Math.max(0, Math.min(1, progress)) * (path.length - 1);
  const i = Math.min(Math.floor(at), path.length - 1), a = path[i]!, b = path[Math.min(i + 1, path.length - 1)]!;
  return { x: a.x + (b.x - a.x) * (at - i), y: a.y + (b.y - a.y) * (at - i) };
}

// Same stable N/E/S/W, terrain-cost ordering as the kernel, for path previews only.
export function visualPath(state: BattleState, unit: UnitState, to: Coord): Coord[] {
  const key = (p: Coord) => `${p.x},${p.y}`;
  const queue = [{ pos: unit.pos, cost: 0, path: [unit.pos] }];
  const costs = new Map([[key(unit.pos), 0]]);
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const n = queue.shift()!;
    if (n.cost !== costs.get(key(n.pos))) continue;
    if (key(n.pos) === key(to)) return n.path;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const pos = { x: n.pos.x + dx!, y: n.pos.y + dy! };
      if (pos.x < 0 || pos.y < 0 || pos.x >= state.boardWidth || pos.y >= state.boardHeight) continue;
      const terrain = state.terrain[pos.y]![pos.x];
      if (terrain === 'wall' || state.units.some(u => u.alive && u.faction !== unit.faction && key(u.pos) === key(pos))) continue;
      const cost = n.cost + (terrain === 'cover' ? 2 : 1);
      if (cost > unit.mov || cost >= (costs.get(key(pos)) ?? Infinity)) continue;
      costs.set(key(pos), cost); queue.push({ pos, cost, path: [...n.path, pos] });
    }
  }
  return [unit.pos];
}

export type MotionPreference = 'system' | 'full' | 'reduced';
export function isReducedMotion(preference: MotionPreference, systemReduced: boolean) {
  return preference === 'reduced' || (preference === 'system' && systemReduced);
}
