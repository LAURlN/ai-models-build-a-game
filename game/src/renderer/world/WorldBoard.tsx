import 'pixi.js/unsafe-eval';
import { useEffect, useRef } from 'react';
import { Application, Container, Graphics, Text } from 'pixi.js';
import type { BattleState, Coord, FxCue, Loose, TileData, UnitState } from '../../engine/types';
import { tileAt } from '../../engine/grid';
import type { Registry } from '../../engine/registry';
import { ATLAS, artSeed, easeOut, pathPosition } from '../presentation';
import { drawBody, hexToNumber } from './sprites';

export const TILE = 48;
export interface BoardProps {
  state: BattleState;
  reg: Registry;
  selectedId: string | null;
  reachable: Coord[];
  attackCells: Coord[];
  targetIds: string[];
  abilityCells: Coord[];
  threat: Coord[];
  cursor: Coord | null;
  path: Coord[];
  /** Cue batch to animate; animated once per distinct key. */
  cues: { key: string; list: FxCue[] };
  reducedMotion: boolean;
  speed: number;
  onTileClick: (c: Coord) => void;
  onTileHover: (c: Coord | null) => void;
}

const LOOKS: Record<string, number[]> = {
  plain: [0xe0d5b7, 0xe5dabc, 0xdccfae], grass: [0xcfd2a6, 0xc8cc9c, 0xd4d6ac], tallgrass: [0xb9c48e, 0xb2be86, 0xbec991], forest: [0x9fb38c, 0x98ad86, 0xa5b991],
  water: [0x9fc0bd, 0x98bab8, 0xa6c5c2], deepwater: [0x6f9a9f, 0x6a959b, 0x75a0a5], wall: [0x697976, 0x74817a, 0x5d706c], rock: [0x8b8a7b, 0x847f72, 0x928f80],
  sand: [0xe8d6a6, 0xe2cf9c, 0xecdcae], road: [0xd2c3a0, 0xcbbc98, 0xd8c9a6], floor: [0xd8ccae, 0xd2c6a8, 0xddd1b3], mud: [0xa9957a, 0xa18d72, 0xb09c80],
  snow: [0xf1eee4, 0xeceadf, 0xf4f2ea], ice: [0xd6e6e6, 0xcfe1e1, 0xdbeaea], rubble: [0xb3aa96, 0xaba28e, 0xbab19d], bridge: [0xc6a77a, 0xbfa072, 0xccad80],
  crop: [0xc8c48a, 0xc1bd82, 0xcecb92], fence: [0xd4d0a8, 0xcfcba2, 0xd9d5ae], lava: [0xc0563a, 0xb84f35, 0xc75d40], metal: [0x9aa4a4, 0x939d9d, 0xa1abab], void: [0x2b3a3c, 0x283638, 0x2e3d3f],
};
const clear = (c: Container): void => { c.removeChildren().forEach((n) => n.destroy({ children: true })); };
const key = (c: Coord): string => `${c.x},${c.y}`;

function drawTileLook(g: Graphics, tile: TileData, px: number, py: number, seed: number): void {
  const look = LOOKS[tile.look] ? tile.look : LOOKS[tile.id] ? tile.id : tile.blocksMove ? 'wall' : 'plain';
  const base = tile.color ? hexToNumber(tile.color, LOOKS[look]![seed % 3]!) : LOOKS[look]![seed % 3]!;
  const s = TILE;
  g.rect(px, py, s, s).fill(base).stroke({ color: 0x8d947c, width: 0.6, alpha: 0.45 });
  const r = (n: number): number => ((seed >>> n) & 31) / 31;
  switch (look) {
    case 'forest': case 'tallgrass':
      for (let i = 0; i < (look === 'forest' ? 3 : 4); i++) {
        const tx = px + 10 + i * 11 + r(i) * 4, ty = py + 16 + (i % 2) * 12;
        if (look === 'forest') {
          g.ellipse(tx + 2, ty + 14, 9, 4).fill({ color: ATLAS.ink, alpha: 0.13 });
          g.rect(tx - 1, ty + 2, 2, 12).fill(0x5d6650);
          g.poly([tx, ty - 11, tx + 9, ty + 7, tx - 9, ty + 7]).fill(i === 1 ? 0x3b6856 : 0x507c5d).stroke({ color: 0x345d4e, width: 0.8 });
        } else g.moveTo(tx, ty + 14).lineTo(tx - 3, ty + 2).moveTo(tx + 2, ty + 14).lineTo(tx + 5, ty + 3).stroke({ color: 0x6f8653, width: 1.2 });
      }
      break;
    case 'water': case 'deepwater':
      for (let i = 0; i < 2; i++) { const y = py + 16 + i * 16 + r(i) * 4; g.moveTo(px + 8, y).bezierCurveTo(px + 18, y - 5, px + 28, y + 5, px + 40, y).stroke({ color: 0xf4f0dc, alpha: 0.5, width: 1 }); }
      break;
    case 'wall':
      g.roundRect(px + 4, py + 9, s - 7, s - 11, 3).fill({ color: ATLAS.shadow, alpha: 0.25 });
      g.roundRect(px + 4, py + 4, s - 9, s - 13, 2).fill(base).stroke({ color: ATLAS.ink, width: 1.2 });
      g.moveTo(px + 6, py + 6).lineTo(px + s - 7, py + 6).stroke({ color: 0xc0c7af, width: 1.5 });
      g.moveTo(px + 5, py + 18).lineTo(px + s - 6, py + 18).moveTo(px + 5, py + 30).lineTo(px + s - 6, py + 30).stroke({ color: 0x415652, width: 0.8 });
      break;
    case 'rock':
      g.poly([px + 8, py + 38, px + 14, py + 14, px + 26, py + 8, px + 38, py + 16, px + 42, py + 38]).fill(0x7a776a).stroke({ color: ATLAS.ink, width: 1 });
      g.moveTo(px + 20, py + 14).lineTo(px + 24, py + 30).stroke({ color: 0xb6b2a0, width: 1 });
      break;
    case 'fence':
      g.moveTo(px, py + 20).lineTo(px + s, py + 20).moveTo(px, py + 30).lineTo(px + s, py + 30).stroke({ color: 0x7d5b3a, width: 2 });
      for (const x of [8, 24, 40]) g.rect(px + x - 1.5, py + 14, 3, 22).fill(0x6d4b2a);
      break;
    case 'crop':
      for (let i = 0; i < 4; i++) { const x = px + 7 + i * 11; g.moveTo(x, py + 40).lineTo(x, py + 10).stroke({ color: 0x7c8a4a, width: 1 }); g.circle(x, py + 12 + r(i) * 6, 2.4).fill(0x9a8a3a); }
      break;
    case 'road': case 'bridge': case 'floor':
      if (look === 'bridge') for (let i = 0; i < 4; i++) g.moveTo(px + 2, py + 6 + i * 12).lineTo(px + s - 2, py + 6 + i * 12).stroke({ color: 0x8a6a42, width: 1 });
      else g.moveTo(px + 6 + r(1) * 30, py + 12).lineTo(px + 10 + r(2) * 30, py + 14).stroke({ color: ATLAS.ink, alpha: 0.18, width: 0.8 });
      break;
    case 'lava':
      g.circle(px + 14 + r(3) * 20, py + 16 + r(5) * 16, 5).fill({ color: 0xf0a24a, alpha: 0.7 });
      break;
    case 'void':
      g.moveTo(px + 10, py + 30).lineTo(px + 18, py + 22).stroke({ color: 0x5b4a7a, width: 1 });
      break;
    default:
      if ((seed & 3) === 0) g.moveTo(px + 5, py + 34).bezierCurveTo(px + 16, py + 22, px + 28, py + 40, px + 42, py + 28).stroke({ color: 0xb3ae8c, alpha: 0.35, width: 0.8 });
  }
}

function factionShape(g: Graphics, shape: string, r: number): Graphics {
  switch (shape) {
    case 'shield': return g.poly([-r, -r * 0.92, r, -r * 0.92, r, r * 0.3, 0, r * 1.05, -r, r * 0.3]);
    case 'diamond': return g.poly([0, -r * 1.12, r * 1.1, 0, 0, r * 1.1, -r * 1.1, 0]);
    case 'hex': return g.poly([-r, 0, -r / 2, -r * 0.9, r / 2, -r * 0.9, r, 0, r / 2, r * 0.9, -r / 2, r * 0.9]);
    case 'square': return g.roundRect(-r * 0.92, -r * 0.92, r * 1.84, r * 1.84, 4);
    case 'triangle': return g.poly([0, -r * 1.1, r * 1.05, r * 0.8, -r * 1.05, r * 0.8]);
    default: return g.circle(0, 0, r);
  }
}

function label(c: Container, text: string, x: number, y: number, size: number, color: number, weight = '700'): Text {
  const t = new Text({ text, style: { fontFamily: 'Segoe UI, sans-serif', fontSize: size, fontWeight: weight as '700', fill: color } });
  t.anchor.set(0.5); t.position.set(x, y); c.addChild(t); return t;
}

function token(state: BattleState, u: UnitState, reg: Registry, env: Loose): Container {
  const c = new Container(), g = new Graphics();
  const faction = state.factions[u.faction];
  const color = hexToNumber(faction?.color, faction?.controller === 'player' ? ATLAS.player : ATLAS.enemy);
  const r = TILE * 0.4;
  g.ellipse(2, r * 0.95, r, r * 0.3).fill({ color: ATLAS.shadow, alpha: 0.28 });
  factionShape(g, faction?.shape ?? 'circle', r).fill(color).stroke({ color: ATLAS.cream, width: 1.6 });
  g.circle(0, -1, r * 0.78).fill(0xc3c5a4).stroke({ color: ATLAS.brass, width: 1.2 });
  c.addChild(g);
  const body = new Graphics();
  const drawer = u.sprite.drawer ? reg.unitDrawers[u.sprite.drawer] : undefined;
  let drawn = false;
  if (drawer) { try { drawer.fn(body, u, env); drawn = true; } catch { body.clear(); } }
  if (!drawn) drawBody(body, u, r * 0.72);
  body.position.set(0, -1);
  c.addChild(body);
  const bar = new Graphics();
  bar.roundRect(-r, r * 0.95, r * 2, 5, 1.5).fill(ATLAS.ink);
  bar.rect(-r + 1, r * 0.95 + 1, (r * 2 - 2) * Math.max(0, u.hp / u.maxHp), 3).fill(u.hp / u.maxHp < 0.35 ? 0xe0866c : ATLAS.cream);
  c.addChild(bar);
  label(c, String(u.hp), -r + 2, r * 0.62, 8, ATLAS.cream).anchor.set(0, 0.5);
  if (u.statuses.length) {
    const pip = new Graphics();
    u.statuses.slice(0, 4).forEach((st, i) => {
      const def = reg.statuses[st.id];
      pip.circle(r * 0.75 - i * 7, -r * 0.85, 3.2).fill(def?.tone === 'buff' ? 0x7fae8a : def?.tone === 'debuff' ? 0xc06a52 : ATLAS.brass).stroke({ color: ATLAS.ink, width: 0.8 });
    });
    c.addChild(pip);
  }
  if (u.acts <= 0 && faction?.controller === 'player' && state.order[state.phaseIndex] === u.faction) {
    c.alpha = 0.66;
    const check = new Graphics().circle(-r * 0.7, -r * 0.7, 6).fill(ATLAS.ink);
    check.moveTo(-r * 0.7 - 3, -r * 0.7).lineTo(-r * 0.7 - 1, -r * 0.7 + 2.5).lineTo(-r * 0.7 + 3, -r * 0.7 - 3).stroke({ color: ATLAS.cream, width: 1.5 });
    c.addChild(check);
  }
  return c;
}

interface Anim { node: Container; path: Coord[]; start: number; duration: number; fade?: boolean }
interface Fx { node: Container; start: number; duration: number; rise: boolean; draw?: (t: number) => void }
interface Scene {
  app: Application; world: Container; terrain: Container; highlights: Container; units: Container; effects: Container;
  terrainKey: string; nodes: Map<string, Container>; anims: Anim[]; fx: Fx[]; cueKey: string; fitted: string;
  cam: { x: number; y: number; scale: number }; dragging: { x: number; y: number; cx: number; cy: number; moved: boolean } | null;
}

const center = (c: Coord): { x: number; y: number } => ({ x: c.x * TILE + TILE / 2, y: c.y * TILE + TILE / 2 });

function viewport(s: Scene): { w: number; h: number } {
  return { w: s.app.renderer.width / s.app.renderer.resolution, h: s.app.renderer.height / s.app.renderer.resolution };
}
/** Keeps the map on screen: centred when it fits, edge-clamped (with a small margin) when it is larger. */
function clampCamera(s: Scene, map: { width: number; height: number }): void {
  const { w, h } = viewport(s), mw = map.width * TILE * s.cam.scale, mh = map.height * TILE * s.cam.scale, margin = 24;
  s.cam.x = mw <= w ? (w - mw) / 2 : Math.min(margin, Math.max(w - mw - margin, s.cam.x));
  s.cam.y = mh <= h ? (h - mh) / 2 : Math.min(margin, Math.max(h - mh - margin, s.cam.y));
}
function applyCamera(s: Scene, map?: { width: number; height: number }): void {
  if (map) clampCamera(s, map);
  s.world.position.set(s.cam.x, s.cam.y); s.world.scale.set(s.cam.scale);
  const canvas = s.app.canvas;
  canvas.dataset.camera = JSON.stringify({ x: Math.round(s.cam.x), y: Math.round(s.cam.y), scale: Number(s.cam.scale.toFixed(4)), tile: TILE });
}
function fitCamera(s: Scene, state: BattleState): void {
  const w = s.app.renderer.width / s.app.renderer.resolution, h = s.app.renderer.height / s.app.renderer.resolution;
  const fit = Math.min(w / (state.map.width * TILE), h / (state.map.height * TILE));
  const scale = Math.max(fit, Math.min(1, 26 / TILE));
  s.cam.scale = Math.min(1.4, scale);
  if (fit >= s.cam.scale - 1e-6) {
    s.cam.x = (w - state.map.width * TILE * s.cam.scale) / 2; s.cam.y = (h - state.map.height * TILE * s.cam.scale) / 2;
  } else {
    const mine = state.units.filter((u) => u.alive && state.factions[u.faction]?.controller === 'player');
    const focus = mine.length ? { x: mine.reduce((n, u) => n + u.pos.x, 0) / mine.length, y: mine.reduce((n, u) => n + u.pos.y, 0) / mine.length } : { x: state.map.width / 2, y: state.map.height / 2 };
    s.cam.x = w / 2 - (focus.x * TILE + TILE / 2) * s.cam.scale; s.cam.y = h / 2 - (focus.y * TILE + TILE / 2) * s.cam.scale;
  }
  applyCamera(s, state.map);
}

function drawTerrain(s: Scene, p: BoardProps): void {
  const state = p.state, k = `${state.id}|${state.seed}|${state.map.width}x${state.map.height}|${state.map.cells.join('')}|${state.map.palette.join(',')}`;
  if (k === s.terrainKey) return;
  s.terrainKey = k; clear(s.terrain);
  const g = new Graphics();
  for (let y = 0; y < state.map.height; y++) for (let x = 0; x < state.map.width; x++) {
    const tile = tileAt(state.map, x, y), seed = artSeed(`${state.seed}/${x}/${y}`);
    const custom = p.reg.tileDrawers[tile.id] ?? p.reg.tileDrawers[tile.look];
    if (custom) {
      const local = new Graphics();
      try { custom.fn(local, tile, { tile: TILE, seed, x, y, palette: PALETTE_HEX }); local.position.set(x * TILE, y * TILE); s.terrain.addChild(local); continue; }
      catch { local.destroy(); }
    }
    drawTileLook(g, tile, x * TILE, y * TILE, seed);
  }
  s.terrain.addChildAt(g, 0);
  const frame = new Graphics().rect(0, 0, state.map.width * TILE, state.map.height * TILE).stroke({ color: ATLAS.brass, width: 3 });
  s.terrain.addChild(frame);
}

const PALETTE_HEX = { ink: '#243c3b', paper: '#e3d8ba', brass: '#c4a15d', cream: '#fff2d4', teal: '#23657a', vermilion: '#9e4536' };

function drawHighlights(s: Scene, p: BoardProps): void {
  clear(s.highlights);
  const g = new Graphics(), t = TILE;
  for (const c of p.threat) {
    g.rect(c.x * t + 1, c.y * t + 1, t - 2, t - 2).fill({ color: ATLAS.enemy, alpha: 0.12 });
    for (let i = 5; i < t - 4; i += 10) g.moveTo(c.x * t + i, c.y * t + t - 6).lineTo(c.x * t + i + 4, c.y * t + t - 10).stroke({ color: ATLAS.enemy, alpha: 0.55, width: 1.2 });
  }
  const reach = new Set(p.reachable.map(key));
  for (const c of p.attackCells) g.rect(c.x * t + 3, c.y * t + 3, t - 6, t - 6).stroke({ color: ATLAS.enemy, alpha: 0.35, width: 1 });
  for (const c of p.reachable) {
    g.rect(c.x * t + 2, c.y * t + 2, t - 4, t - 4).fill({ color: ATLAS.player, alpha: 0.17 });
    for (const [dx, dy, ax, ay, bx, by] of [[0, -1, 2, 2, t - 2, 2], [1, 0, t - 2, 2, t - 2, t - 2], [0, 1, 2, t - 2, t - 2, t - 2], [-1, 0, 2, 2, 2, t - 2]] as const) {
      if (!reach.has(`${c.x + dx},${c.y + dy}`)) g.moveTo(c.x * t + ax, c.y * t + ay).lineTo(c.x * t + bx, c.y * t + by).stroke({ color: ATLAS.player, width: 2 });
    }
  }
  for (const c of p.abilityCells) {
    g.circle(c.x * t + t / 2, c.y * t + t / 2, t * 0.32).stroke({ color: ATLAS.brass, width: 2 });
    g.circle(c.x * t + t / 2, c.y * t + t / 2, 3).fill(ATLAS.brass);
  }
  for (const u of p.state.units) {
    if (!u.alive || !p.targetIds.includes(u.id)) continue;
    const x = u.pos.x * t, y = u.pos.y * t;
    for (const [cx, cy, dx, dy] of [[x + 3, y + 3, 1, 1], [x + t - 3, y + 3, -1, 1], [x + 3, y + t - 3, 1, -1], [x + t - 3, y + t - 3, -1, -1]] as const) {
      g.moveTo(cx, cy + dy * 9).lineTo(cx, cy).lineTo(cx + dx * 9, cy).stroke({ color: ATLAS.enemy, width: 3 });
    }
  }
  for (const cond of p.state.objective.win) {
    const at = Array.isArray(cond.at) ? { x: cond.at[0], y: cond.at[1] } : cond.at && typeof cond.at === 'object' ? cond.at : null;
    if ((cond.type === 'seize' || cond.type === 'reach') && at) {
      const { x, y } = center(at);
      g.poly([x, y - 16, x + 4, y - 5, x + 16, y - 4, x + 7, y + 4, x + 10, y + 16, x, y + 9, x - 10, y + 16, x - 7, y + 4, x - 16, y - 4, x - 4, y - 5]).fill({ color: ATLAS.brass, alpha: 0.85 }).stroke({ color: ATLAS.ink, width: 1.5 });
    }
  }
  const sel = p.state.units.find((u) => u.id === p.selectedId && u.alive);
  if (sel) g.roundRect(sel.pos.x * t + 2, sel.pos.y * t + 2, t - 4, t - 4, 6).stroke({ color: ATLAS.brass, width: 3 });
  if (p.path.length > 1) {
    const pts = p.path.map(center);
    g.moveTo(pts[0]!.x, pts[0]!.y); for (const q of pts.slice(1)) g.lineTo(q.x, q.y); g.stroke({ color: ATLAS.cream, width: 5 });
    g.moveTo(pts[0]!.x, pts[0]!.y); for (const q of pts.slice(1)) g.lineTo(q.x, q.y); g.stroke({ color: ATLAS.player, width: 2 });
  }
  if (p.cursor) g.roundRect(p.cursor.x * t + 1, p.cursor.y * t + 1, t - 2, t - 2, 4).stroke({ color: ATLAS.cream, width: 3 }).stroke({ color: ATLAS.ink, width: 1 });
  s.highlights.addChild(g);
}

function floatText(s: Scene, text: string, at: Coord, color: number, now: number, reduced: boolean, duration = 1100): void {
  const shown = text.length > 34 ? `${text.slice(0, 33)}…` : text;
  const c = new Container(), w = Math.max(36, shown.length * 6.4 + 14);
  c.addChild(new Graphics().roundRect(-w / 2, -10, w, 20, 4).fill(ATLAS.ink).stroke({ color, width: 1.4 }));
  label(c, shown, 0, 0, 10, ATLAS.cream);
  const p = center(at); c.position.set(p.x, p.y - TILE * 0.45);
  s.effects.addChild(c); s.fx.push({ node: c, start: now, duration: reduced ? duration + 300 : duration, rise: !reduced });
}

function builtinEffect(id: string, cue: FxCue, reduced: boolean): ((g: Graphics, t: number) => void) | null {
  const at = cue.at ? center(cue.at) : null, from = cue.from ? center(cue.from) : at;
  const color = typeof cue.params?.color === 'string' ? hexToNumber(cue.params.color, ATLAS.brass) : ATLAS.brass;
  const size = (typeof cue.params?.size === 'number' ? cue.params.size : 1) * TILE * 0.6;
  if (!at) return null;
  switch (id) {
    case 'beam': return (g, t) => { if (from) g.moveTo(from.x, from.y).lineTo(at.x, at.y).stroke({ color, width: 4 * (1 - t) + 1, alpha: 1 - t }); };
    case 'burst': case 'shock': return (g, t) => { for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2, r0 = size * 0.3 + size * t, r1 = r0 + 8; g.moveTo(at.x + Math.cos(a) * r0, at.y + Math.sin(a) * r0).lineTo(at.x + Math.cos(a) * r1, at.y + Math.sin(a) * r1).stroke({ color, width: 2, alpha: 1 - t }); } };
    case 'sparkle': return (g, t) => { for (let i = 0; i < 6; i++) { const a = i * 1.05 + t * 2; g.circle(at.x + Math.cos(a) * size * 0.6, at.y + Math.sin(a) * size * 0.6 - (reduced ? 0 : t * 10), 2.2).fill({ color: ATLAS.cream, alpha: 1 - t }); } };
    case 'ripple': return (g, t) => { g.circle(at.x, at.y, size * (0.3 + t)).stroke({ color, width: 2, alpha: 1 - t }); g.circle(at.x, at.y, size * (0.15 + t * 0.6)).stroke({ color, width: 1, alpha: 1 - t }); };
    default: return (g, t) => { g.circle(at.x, at.y, size * (reduced ? 0.8 : 0.5 + t * 0.6)).stroke({ color, width: 3, alpha: 1 - t * 0.8 }); };
  }
}

function playCues(s: Scene, p: BoardProps, now: number): void {
  if (p.cues.key === s.cueKey) return;
  s.cueKey = p.cues.key;
  const reduced = p.reducedMotion, speed = Math.max(0.15, p.speed);
  let floats = 0;
  for (const cue of p.cues.list) {
    if (floats > 30) break;
    const addFx = (draw: (g: Graphics, t: number) => void, duration: number): void => {
      const node = new Container(), g = new Graphics(); node.addChild(g); s.effects.addChild(node);
      s.fx.push({ node, start: now, duration: duration * speed, rise: false, draw: (t) => { g.clear(); draw(g, t); } });
    };
    switch (cue.t) {
      case 'move': case 'teleport': {
        const node = cue.unit ? s.nodes.get(cue.unit) : undefined;
        if (node && !reduced && cue.path && cue.path.length > 1) {
          const pathCells = cue.path;
          s.anims = s.anims.filter((a) => a.node !== node);
          s.anims.push({ node, path: pathCells, start: now, duration: Math.min(420, (pathCells.length - 1) * 90) * speed });
          const first = center(pathCells[0]!); node.position.set(first.x, first.y);
        }
        break;
      }
      case 'strike': {
        if (!cue.from || !cue.to) break;
        const crit = cue.outcome === 'crit', from = center(cue.from), to = center(cue.to);
        if (!reduced) addFx((g, t) => {
          g.moveTo(from.x, from.y).lineTo(from.x + (to.x - from.x) * Math.min(1, t * 2), from.y + (to.y - from.y) * Math.min(1, t * 2)).stroke({ color: ATLAS.brass, width: crit ? 5 : 2.5, alpha: 1 - t });
          g.circle(to.x, to.y, (crit ? 26 : 18) + t * 8).stroke({ color: crit ? ATLAS.brass : ATLAS.cream, width: crit ? 3 : 2, alpha: 1 - t });
        }, crit ? 520 : 360);
        floatText(s, cue.outcome === 'miss' ? 'MISS' : `${crit ? 'CRIT ' : ''}−${cue.amount ?? 0}`, cue.to, crit ? ATLAS.brass : cue.outcome === 'miss' ? ATLAS.brass : ATLAS.cream, now, reduced); floats++;
        break;
      }
      case 'damage': if (cue.at && (cue.amount ?? 0) > 0) { floatText(s, `−${cue.amount}`, cue.at, 0xe0866c, now, reduced); floats++; } break;
      case 'heal': if (cue.at && (cue.amount ?? 0) > 0) { floatText(s, `+${cue.amount}`, cue.at, 0x7fae8a, now, reduced); floats++; } break;
      case 'float': if (cue.at) { floatText(s, cue.text ?? '', cue.at, cue.tone === 'buff' ? 0x7fae8a : cue.tone === 'debuff' ? 0xe0866c : ATLAS.brass, now, reduced, 1400); floats++; } break;
      case 'status': if (cue.at) { floatText(s, cue.text ?? 'Status', cue.at, cue.tone === 'buff' ? 0x7fae8a : cue.tone === 'debuff' ? 0xe0866c : ATLAS.brass, now, reduced); floats++; if (!reduced) addFx(builtinEffect('ring', cue, reduced)!, 600); } break;
      case 'status-end': if (cue.at) { floatText(s, `${cue.text ?? 'Status'} ends`, cue.at, ATLAS.brass, now, reduced); floats++; } break;
      case 'ability': {
        if (cue.at) { floatText(s, cue.text ?? 'Ability', cue.from ?? cue.at, ATLAS.brass, now, reduced, 1300); floats++; }
        const fxId = typeof cue.params?.fx === 'string' && cue.params.fx ? cue.params.fx : 'ripple';
        const custom = p.reg.effects[fxId];
        if (custom && cue.at) addFx((g, t) => { try { custom.draw(g, t, cue, { tile: TILE, center, palette: PALETTE_HEX, reduced }); } catch { /* broken effect: skip */ } }, custom.duration);
        else if (!reduced) { const draw = builtinEffect(fxId, cue, reduced); if (draw) addFx(draw, 650); }
        break;
      }
      case 'fx': {
        const custom = cue.id ? p.reg.effects[cue.id] : undefined;
        if (custom) addFx((g, t) => { try { custom.draw(g, t, cue, { tile: TILE, center, palette: PALETTE_HEX, reduced }); } catch { /* skip */ } }, custom.duration);
        else { const draw = builtinEffect(cue.id ?? 'ring', cue, reduced); if (draw) addFx(draw, reduced ? 500 : 650); }
        break;
      }
      case 'defeat': case 'remove': {
        if (cue.at) { floatText(s, cue.t === 'defeat' ? 'DOWN' : (cue.text ?? 'gone').toUpperCase(), cue.at, ATLAS.enemy, now, reduced); floats++; }
        break;
      }
      case 'spawn': if (cue.at && !reduced) addFx(builtinEffect('ripple', cue, reduced)!, 600); break;
      default: break;
    }
  }
}

function syncUnits(s: Scene, p: BoardProps, now: number): void {
  const env = { tile: TILE, palette: PALETTE_HEX, reduced: p.reducedMotion };
  const seen = new Set<string>();
  for (const u of p.state.units) {
    const old = s.nodes.get(u.id);
    if (!u.alive) {
      if (old && !s.anims.some((a) => a.node === old && a.fade)) {
        if (p.reducedMotion) { old.destroy({ children: true }); s.nodes.delete(u.id); }
        else s.anims.push({ node: old, path: [u.pos], start: now, duration: 500, fade: true });
      }
      continue;
    }
    seen.add(u.id);
    const node = token(p.state, u, p.reg, env);
    const at = center(u.pos);
    if (old) { node.position.copyFrom(old.position); old.destroy({ children: true }); for (const a of s.anims) if (a.node === old) a.node = node; }
    else node.position.set(at.x, at.y);
    if (!s.anims.some((a) => a.node === node)) node.position.set(at.x, at.y);
    s.units.addChild(node); s.nodes.set(u.id, node);
  }
  for (const [id, node] of [...s.nodes]) {
    if (!seen.has(id) && !s.anims.some((a) => a.node === node && a.fade)) { node.destroy({ children: true }); s.nodes.delete(id); }
  }
}

function update(s: Scene, p: BoardProps, changed: { state: boolean; cues: boolean }): void {
  const now = performance.now();
  drawTerrain(s, p);
  if (s.fitted !== p.state.id) { s.fitted = p.state.id; fitCamera(s, p.state); }
  if (changed.state) syncUnits(s, p, now);
  if (changed.cues) playCues(s, p, now);
  drawHighlights(s, p);
}

export function WorldBoard(props: BoardProps) {
  const host = useRef<HTMLDivElement>(null), latest = useRef(props), scene = useRef<Scene | null>(null);
  const prev = useRef<{ state: BattleState | null; cues: string }>({ state: null, cues: '' });
  latest.current = props;
  useEffect(() => {
    let disposed = false, app: Application | null = null;
    const mount = async () => {
      const instance = new Application();
      const options = { backgroundColor: 0x1d3436, antialias: true, resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true, resizeTo: host.current! };
      try { await instance.init({ ...options, preference: 'webgl' }); } catch { await instance.init({ ...options, preference: 'canvas' }); }
      if (disposed) { instance.destroy(true, { children: true }); return; }
      app = instance; instance.ticker.maxFPS = 60;
      const canvas = instance.canvas;
      canvas.dataset.testid = 'world-canvas';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', 'Battle map. Drag to pan, wheel to zoom, arrow keys or WASD to move the cursor, Enter to act.');
      host.current!.appendChild(canvas);
      const world = new Container(), terrain = new Container(), highlights = new Container(), units = new Container(), effects = new Container();
      world.addChild(terrain, highlights, units, effects); instance.stage.addChild(world);
      const s: Scene = { app: instance, world, terrain, highlights, units, effects, terrainKey: '', nodes: new Map(), anims: [], fx: [], cueKey: '', fitted: '', cam: { x: 0, y: 0, scale: 1 }, dragging: null };
      scene.current = s;
      const cellAt = (e: PointerEvent | MouseEvent): Coord | null => {
        const r = canvas.getBoundingClientRect();
        const x = Math.floor((e.clientX - r.left - s.cam.x) / (TILE * s.cam.scale)), y = Math.floor((e.clientY - r.top - s.cam.y) / (TILE * s.cam.scale));
        const st = latest.current.state;
        return x >= 0 && y >= 0 && x < st.map.width && y < st.map.height ? { x, y } : null;
      };
      let hovered = '';
      canvas.onpointerdown = (e) => { s.dragging = { x: e.clientX, y: e.clientY, cx: s.cam.x, cy: s.cam.y, moved: false }; };
      canvas.onpointermove = (e) => {
        if (s.dragging && (e.buttons & 1 || e.buttons & 4)) {
          const dx = e.clientX - s.dragging.x, dy = e.clientY - s.dragging.y;
          if (Math.abs(dx) + Math.abs(dy) > 6) s.dragging.moved = true;
          if (s.dragging.moved) { s.cam.x = s.dragging.cx + dx; s.cam.y = s.dragging.cy + dy; applyCamera(s, latest.current.state.map); }
          return;
        }
        const c = cellAt(e), next = c ? key(c) : '';
        if (next !== hovered) { hovered = next; latest.current.onTileHover(c); }
      };
      canvas.onpointerup = (e) => {
        const drag = s.dragging; s.dragging = null;
        if (drag?.moved) return;
        if (e.button === 0) { const c = cellAt(e); if (c) latest.current.onTileClick(c); }
      };
      canvas.onpointerleave = () => { s.dragging = null; hovered = ''; latest.current.onTileHover(null); };
      canvas.onwheel = (e) => {
        e.preventDefault();
        const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
        const next = Math.max(0.2, Math.min(2.5, s.cam.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
        s.cam.x = mx - ((mx - s.cam.x) / s.cam.scale) * next; s.cam.y = my - ((my - s.cam.y) / s.cam.scale) * next; s.cam.scale = next;
        applyCamera(s, latest.current.state.map);
      };
      canvas.ondblclick = () => fitCamera(s, latest.current.state);
      update(s, latest.current, { state: true, cues: true });
      prev.current = { state: latest.current.state, cues: latest.current.cues.key };
      let lastSize = '';
      instance.ticker.add(() => {
        const now = performance.now(), reduced = latest.current.reducedMotion;
        const size = `${instance.renderer.width}x${instance.renderer.height}`;
        if (size !== lastSize) { lastSize = size; applyCamera(s, latest.current.state.map); }
        s.anims = s.anims.filter((a) => {
          if (a.node.destroyed) return false;
          const t = Math.min(1, (now - a.start) / Math.max(1, a.duration));
          if (a.fade) { a.node.alpha = 1 - t; a.node.scale.set(1 - t * 0.25); if (t >= 1) { a.node.destroy({ children: true }); for (const [id, n] of s.nodes) if (n === a.node) s.nodes.delete(id); } return t < 1; }
          const pos = pathPosition(a.path, easeOut(t)), c = center({ x: pos.x, y: pos.y });
          a.node.position.set(c.x, c.y);
          return t < 1;
        });
        s.fx = s.fx.filter((f) => {
          const t = (now - f.start) / f.duration;
          if (t >= 1 || f.node.destroyed) { if (!f.node.destroyed) f.node.destroy({ children: true }); return false; }
          f.draw?.(t);
          if (f.rise && !reduced) f.node.y -= 0.25;
          f.node.alpha = f.draw ? 1 : Math.min(1, (1 - t) * 3);
          return true;
        });
        const animating = String(s.anims.length);
        if (canvas.dataset.animating !== animating) canvas.dataset.animating = animating;
      });
    };
    void mount().catch((error) => { if (!disposed && host.current) { host.current.textContent = `Unable to draw the map: ${String(error)}`; host.current.setAttribute('role', 'alert'); } });
    return () => { disposed = true; scene.current = null; app?.destroy(true, { children: true }); };
  }, []);
  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    const changed = { state: prev.current.state !== props.state, cues: prev.current.cues !== props.cues.key };
    prev.current = { state: props.state, cues: props.cues.key };
    update(s, props, changed);
  });
  return <div ref={host} className="world-board" data-testid="world-board" />;
}

