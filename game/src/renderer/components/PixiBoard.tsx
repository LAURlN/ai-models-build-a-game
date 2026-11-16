import 'pixi.js/unsafe-eval';
import { useEffect, useRef } from 'react';
import { Application, Container, Graphics, Text } from 'pixi.js';
import type { BattleSnapshot, Coord, UnitState } from '../../shared/contracts';
import { ATLAS, easeOut, pathPosition, terrainRecipe, unitRecipe, visualPath } from '../presentation';

export const TILE_SIZE = 64;
export const BOARD_PIXEL_SIZE = TILE_SIZE * 10;
export interface FloatingBadge { id: string; coord: Coord; text: string; color: number }
interface Props {
  snapshot: BattleSnapshot; cursor: Coord | null; threatTiles?: Coord[];
  activeMovePath?: Coord[]; activeUnitId?: string | null; floatingBadges?: FloatingBadge[];
  reducedMotion?: boolean; replayActive?: boolean; motionSpeed?: number; onTileClick: (coord: Coord) => void; onTileHover: (coord: Coord | null) => void;
}
const clear = (c: Container) => c.removeChildren().forEach(n => n.destroy({ children: true }));
const key = (c: Coord) => `${c.x},${c.y}`;
function label(c: Container, text: string, x: number, y: number, size = 10, color = ATLAS.ink) {
  const t = new Text({ text, style: { fontFamily: 'Segoe UI, sans-serif', fontSize: size, fontWeight: '700', fill: color } });
  t.anchor.set(0.5); t.position.set(x, y); c.addChild(t); return t;
}

function terrainLayer(c: Container, snapshot: BattleSnapshot) {
  clear(c);
  const { state: s } = snapshot, g = new Graphics();
  for (let y = 0; y < s.boardHeight; y++) for (let x = 0; x < s.boardWidth; x++) {
    const t = s.terrain[y]![x]!, r = terrainRecipe(s.seed, x, y, t), px = x * TILE_SIZE, py = y * TILE_SIZE;
    g.rect(px, py, TILE_SIZE, TILE_SIZE).fill(r.color).stroke({ color: 0x8d947c, width: 0.65, alpha: 0.5 });
    g.moveTo(px + 1, py + 63).lineTo(px + 1, py + 1).lineTo(px + 63, py + 1).stroke({ color: 0xfff2d4, alpha: 0.25, width: 1 });
    for (let i = 0; i < r.flecks; i++) {
      const a = (r.seed >>> (i * 3)) % 50 + 7, b = (r.seed >>> (i * 2 + 4)) % 48 + 8;
      g.moveTo(px + a, py + b).lineTo(px + a + 3, py + b - 1).stroke({ color: ATLAS.ink, alpha: 0.12, width: 0.7 });
    }
    if (t === 'wall') {
      g.roundRect(px + 5, py + 13, 55, 47, 4).fill({ color: ATLAS.shadow, alpha: 0.28 });
      g.poly([px + 6, py + 12, px + 52, py + 12, px + 59, py + 49, px + 11, py + 49]).fill(0x4c635f);
      g.roundRect(px + 6, py + 5, 49, 43, 3).fill(r.color).stroke({ color: ATLAS.ink, width: 1.5 });
      g.moveTo(px + 8, py + 7).lineTo(px + 52, py + 7).stroke({ color: 0xc0c7af, width: 2 });
      for (let i = 1; i < 3; i++) g.moveTo(px + 7, py + 5 + i * 14).lineTo(px + 54, py + 5 + i * 14).stroke({ color: 0x415652, width: 1 });
      g.moveTo(px + 29, py + 6).lineTo(px + 29, py + 19).moveTo(px + 18, py + 20).lineTo(px + 18, py + 33).moveTo(px + 40, py + 34).lineTo(px + 40, py + 47).stroke({ color: 0x415652, width: 1 });
    } else if (t === 'cover') {
      g.ellipse(px + 32, py + 43, 26, 15).stroke({ color: 0x496a52, alpha: 0.5, width: 1 });
      for (let i = 0; i < 3; i++) {
        const tx = px + 16 + i * 15, ty = py + 24 + (i % 2) * 11;
        g.ellipse(tx + 3, ty + 15, 13, 7).fill({ color: ATLAS.ink, alpha: 0.15 });
        g.rect(tx - 1, ty + 1, 3, 19).fill(0x5d6650);
        g.poly([tx, ty - 15, tx + 13, ty + 10, tx - 13, ty + 10]).fill(i === 1 ? 0x3b6856 : 0x507c5d).stroke({ color: 0x345d4e, width: 1 });
        g.moveTo(tx, ty - 10).lineTo(tx - 8, ty + 6).stroke({ color: 0xafc39a, width: 1.4 });
      }
    } else {
      // Engraved contour fragments, not fictional elevation mechanics.
      if (r.variation === 0) g.moveTo(px + 6, py + 46).bezierCurveTo(px + 22, py + 30, px + 39, py + 58, px + 58, py + 39).stroke({ color: 0xb3ae8c, alpha: 0.38, width: 0.8 });
      g.moveTo(px + 53, py + 56).lineTo(px + 58, py + 56).lineTo(px + 58, py + 51).stroke({ color: 0x8a9477, alpha: 0.45, width: 0.8 });
    }
  }
  c.addChild(g);
}

function weapon(g: Graphics, tag: UnitState['weapon']['tag'], x: number, y: number) {
  const ink = ATLAS.cream;
  if (tag === 'bow') {
    g.moveTo(x - 4, y - 9).quadraticCurveTo(x + 11, y, x - 4, y + 9).lineTo(x - 4, y - 9).stroke({ color: ink, width: 1.7 });
    g.moveTo(x - 7, y).lineTo(x + 8, y).lineTo(x + 4, y - 3).stroke({ color: ink, width: 1.7 });
  } else if (tag === 'tome') {
    g.poly([x - 9, y - 7, x, y - 4, x + 9, y - 7, x + 9, y + 7, x, y + 9, x - 9, y + 7]).stroke({ color: ink, width: 1.7 });
    g.moveTo(x, y - 3).lineTo(x, y + 8).stroke({ color: ink, width: 1 });
  } else {
    g.moveTo(x, y + 10).lineTo(x, y - 9).stroke({ color: ink, width: 2 });
    if (tag === 'axe') g.poly([x, y - 8, x + 8, y - 10, x + 9, y - 1, x, y - 3]).fill(ink);
    else if (tag === 'lance') g.poly([x, y - 13, x + 4, y - 5, x, y - 7, x - 4, y - 5]).fill(ink);
    else g.moveTo(x - 5, y + 3).lineTo(x + 5, y + 3).stroke({ color: ink, width: 2 });
  }
}

function token(unit: UnitState): Container {
  const c = new Container(), g = new Graphics(), r = unitRecipe(unit);
  const primary = r.factionColor;
  g.ellipse(2, 22, 25, 8).fill({ color: ATLAS.shadow, alpha: 0.3 });
  if (r.factionShape === 'shield') g.poly([-25, -24, 25, -24, 25, 8, 0, 28, -25, 8]);
  else g.poly([0, -30, 29, 0, 0, 29, -29, 0]);
  g.fill(primary).stroke({ color: ATLAS.cream, width: 2 });
  g.circle(0, -2, 21).fill(0x243f40).stroke({ color: ATLAS.brass, width: 2 });
  g.circle(-2, -4, 17).fill(0xc3c5a4);
  // Seeded mantle, persistent face and class-specific headgear.
  g.poly([-18, 12, -10 - r.mantle * 2, 1, 8, 0, 17, 13, 0, 18]).fill(primary).stroke({ color: r.trim, width: 1.4 });
  g.roundRect(-8, -12, 14, 20, 6).fill(r.skin);
  g.poly([-10, -8, -8, -17, 5, -19, 10, -9, 3, -12, -6, -10]).fill(r.hair);
  if (r.helm === 0) g.poly([-12, -10, -9, -20, 8, -20, 12, -10, 1, -14]).fill(0x597879).stroke({ color: r.trim, width: 1 });
  if (r.helm === 1) g.poly([-13, -10, -4, -27, 9, -11, 14, -9]).fill(primary).stroke({ color: r.trim, width: 1 });
  if (r.helm === 2) g.moveTo(-10, -13).lineTo(-7, -20).lineTo(0, -16).lineTo(7, -20).lineTo(10, -12).stroke({ color: r.trim, width: 3 });
  if (r.helm === 3) g.poly([-13, -8, -12, -18, 2, -23, 13, -13, 8, -4, 7, -15, -6, -14, -8, -3]).fill(primary).stroke({ color: r.trim, width: 1 });
  g.moveTo(-5, -4).lineTo(-3, -4).moveTo(2, -4).lineTo(4, -4).stroke({ color: ATLAS.ink, width: 1.5 });
  for (let i = 0; i <= r.crest; i++) g.circle(-7 + i * 3, 13, 1).fill(r.trim);
  g.roundRect(11, -4, 17, 27, 4).fill(primary).stroke({ color: ATLAS.cream, width: 1 });
  weapon(g, r.weapon, 19.5, 8.5);
  g.roundRect(-25, 28, 50, 7, 2).fill(ATLAS.ink);
  g.rect(-23, 30, 46 * Math.max(0, unit.hp / unit.maxHp), 3).fill(ATLAS.cream);
  for (let i = 1; i < 5; i++) g.moveTo(-23 + i * 9.2, 30).lineTo(-23 + i * 9.2, 33).stroke({ color: ATLAS.ink, width: 1 });
  c.addChild(g);
  label(c, `${unit.hp}`, -18, 20, 9, ATLAS.cream);
  if (unit.hasActed) {
    c.alpha = 0.64;
    const check = new Graphics().circle(-18, 16, 8).fill(ATLAS.ink);
    check.moveTo(-22, 16).lineTo(-19, 19).lineTo(-14, 12).stroke({ color: ATLAS.cream, width: 2 }); c.addChild(check);
  }
  const stacks = unit.statuses.reduce((n, s) => n + s.stacks, 0);
  if (stacks) {
    const b = new Graphics().roundRect(-8, -25, 39, 13, 3).fill(0x6a4232).stroke({ color: ATLAS.brass, width: 1 }); c.addChild(b);
    label(c, `DBT×${stacks}`, 11, -18.5, 8, ATLAS.cream);
  }
  c.position.set(unit.pos.x * TILE_SIZE + 32, unit.pos.y * TILE_SIZE + 26);
  return c;
}

interface Motion { node: Container; path: Coord[]; start: number; duration: number; dying?: boolean; hit?: boolean }
interface Effect { node: Container; start: number; duration: number; originY: number; fixed?: boolean; expand?: boolean }
interface Scene {
  app: Application; terrain: Container; highlights: Container; units: Container; effects: Container; ambient: Container;
  previous: BattleSnapshot | null; wasReplay: boolean; terrainKey: string; motions: Motion[]; feedback: Effect[]; badgeKey: string;
}

function highlights(c: Container, p: Props) {
  clear(c); const g = new Graphics(), { state: s } = p.snapshot;
  const reach = new Set(p.snapshot.reachableTiles.map(key));
  const cell = (a: Coord) => [a.x * 64, a.y * 64] as const;
  for (const a of p.threatTiles ?? []) {
    const [x, y] = cell(a);
    g.rect(x + 1, y + 1, 62, 62).fill({ color: ATLAS.enemy, alpha: 0.13 });
    for (let i = 6; i < 60; i += 12) g.moveTo(x + i, y + 58).lineTo(x + i + 5, y + 53).stroke({ color: ATLAS.enemy, alpha: 0.6, width: 1.4 });
  }
  for (const a of p.snapshot.reachableTiles) {
    const [x, y] = cell(a);
    g.rect(x + 2, y + 2, 60, 60).fill({ color: ATLAS.player, alpha: 0.17 });
    // Outline the union; dotted cell centres keep the terrain legible.
    for (const [dx, dy, ax, ay, bx, by] of [[0,-1,2,2,62,2],[1,0,62,2,62,62],[0,1,2,62,62,62],[-1,0,2,2,2,62]]) {
      if (!reach.has(`${a.x + dx!},${a.y + dy!}`)) g.moveTo(x + ax!, y + ay!).lineTo(x + bx!, y + by!).stroke({ color: ATLAS.player, width: 2 });
    }
    g.circle(x + 32, y + 32, 2).fill({ color: ATLAS.player, alpha: 0.65 });
  }
  const selected = s.units.find(u => u.id === (p.activeUnitId ?? s.selectedUnitId) && u.alive);
  if (selected) {
    const [x,y] = cell(selected.pos);
    g.roundRect(x + 2, y + 2, 60, 60, 8).stroke({ color: ATLAS.brass, width: 3 });
  }
  for (const u of s.units.filter(u => u.alive && p.snapshot.attackableTargetIds.includes(u.id))) {
    const [x,y] = cell(u.pos);
    for (const [cx,cy,dx,dy] of [[x+3,y+3,1,1],[x+61,y+3,-1,1],[x+3,y+61,1,-1],[x+61,y+61,-1,-1]]) {
      g.moveTo(cx!,cy!+dy!*11).lineTo(cx!,cy!).lineTo(cx!+dx!*11,cy!).stroke({ color: ATLAS.enemy, width: 3 });
    }
  }
  if (s.objectiveType === 'seize' && s.seizeTile) {
    const [x,y] = cell(s.seizeTile);
    g.poly([x+32,y+8,x+38,y+24,x+56,y+26,x+42,y+37,x+46,y+55,x+32,y+45,x+18,y+55,x+22,y+37,x+8,y+26,x+26,y+24]).fill({ color: ATLAS.brass, alpha: 0.85 }).stroke({ color: ATLAS.ink, width: 2 });
  }
  let path = p.activeMovePath ?? [];
  if (selected && p.cursor && reach.has(key(p.cursor))) path = visualPath(s, selected, p.cursor);
  if (path.length > 1) {
    g.moveTo(path[0]!.x*64+32,path[0]!.y*64+32);
    for (const a of path.slice(1)) g.lineTo(a.x*64+32,a.y*64+32);
    g.stroke({ color: ATLAS.cream, width: 5 });
    g.moveTo(path[0]!.x*64+32,path[0]!.y*64+32);
    for (const a of path.slice(1)) g.lineTo(a.x*64+32,a.y*64+32);
    g.stroke({ color: p.activeUnitId ? ATLAS.enemy : ATLAS.player, width: 2 });
  }
  if (p.cursor) {
    const [x,y] = cell(p.cursor);
    g.roundRect(x + 1, y + 1, 62, 62, 4).stroke({ color: ATLAS.cream, width: 4 }).stroke({ color: ATLAS.ink, width: 1.5 });
  }
  c.addChild(g);
}

function feedback(scene: Scene, text: string, coord: Coord, color: number, start: number, reduced: boolean) {
  const textLabel = text.length > 36 ? `${text.slice(0,35)}…` : text;
  const c = new Container(), w = Math.max(44, textLabel.length * 7 + 16);
  c.addChild(new Graphics().roundRect(-w/2,-11,w,22,5).fill(ATLAS.ink).stroke({ color, width: 1.5 }));
  label(c, textLabel, 0, 0, 11, ATLAS.cream); c.position.set(Math.max(w/2+4,Math.min(BOARD_PIXEL_SIZE-w/2-4,coord.x*64+32)),Math.max(14,coord.y*64+10));
  scene.effects.addChild(c); scene.feedback.push({ node:c, start, duration: reduced ? 1100 : 1000, originY:c.y });
}

function update(scene: Scene, p: Props) {
  const s = p.snapshot.state, prev = scene.previous?.state, now = performance.now();
  const terrainKey = `${s.seed}/${JSON.stringify(s.terrain)}`;
  if (scene.terrainKey !== terrainKey) { terrainLayer(scene.terrain,p.snapshot); scene.terrainKey = terrainKey; }
  highlights(scene.highlights,p);
  if (scene.previous !== p.snapshot) {
    clear(scene.units); scene.motions = [];
    const forward = prev && !(scene.wasReplay && !p.replayActive) && s.seed === prev.seed && s.chapterId === prev.chapterId && s.commandOrdinal >= prev.commandOrdinal;
    if (!forward) { clear(scene.effects); scene.feedback = []; scene.badgeKey = ''; }
    const previousIds = new Set(prev?.events.map(e => e.id) ?? []);
    const events = forward ? s.events.filter(e => !previousIds.has(e.id)) : [];
    const attacks = events.filter(e => e.kind === 'attack');
    for (const u of s.units) {
      const old = forward ? prev.units.find(o => o.id === u.id) : undefined;
      if (!u.alive && (!old?.alive || p.reducedMotion)) continue;
      const node = token(u); scene.units.addChild(node);
      let path = [u.pos], duration = 0;
      if (old && u.alive && key(old.pos) !== key(u.pos)) {
        path = p.activeUnitId === u.id && p.activeMovePath?.length ? p.activeMovePath : visualPath(prev!, old, u.pos);
        if (key(path[path.length-1]!) !== key(u.pos)) path = [u.pos];
        duration = Math.min(420, (path.length-1)*90) * (p.motionSpeed ?? 1);
      }
      if (!p.reducedMotion && (duration || !u.alive || (old && u.hp < old.hp))) {
        scene.motions.push({ node, path, start:now, duration:duration || 400, dying:!u.alive, hit:!!old && u.hp < old.hp });
        const a = path[0]!; node.position.set(a.x*64+32,a.y*64+26);
      }
      if (old && u.hp !== old.hp) {
        const crit = attacks.some(e => e.message.includes(`→ ${u.name}:`) && e.message.includes(' crit;'));
        feedback(scene, `${crit ? 'CRIT ' : ''}${u.hp-old.hp > 0 ? '+' : ''}${u.hp-old.hp}${!u.alive ? ' · DOWN' : ''}`, u.pos, crit ? ATLAS.brass : ATLAS.cream, now, !!p.reducedMotion);
      }
      if (old && u.statuses.length > old.statuses.length && !p.reducedMotion) {
        const ring = new Container(); ring.addChild(new Graphics().circle(0,0,29).stroke({ color:ATLAS.brass,width:3 }).circle(0,0,21).stroke({color:ATLAS.cream,width:1}));
        ring.position.set(u.pos.x*64+32,u.pos.y*64+30); scene.effects.addChild(ring);
        scene.feedback.push({node:ring,start:now,duration:700,originY:ring.y,fixed:true,expand:true});
      }
    }
    for (const e of attacks) {
      const target = s.units.find(u => e.message.includes(`→ ${u.name}:`));
      const actor = s.units.find(u => e.message.startsWith(`${u.name} →`));
      if (!target || !actor) continue;
      if (e.message.includes(' miss;')) feedback(scene,'MISS',target.pos,ATLAS.brass,now,!!p.reducedMotion);
      if (!p.reducedMotion) {
        const crit = e.message.includes(' crit;'), sweep = new Container(), g = new Graphics();
        const x = target.pos.x*64+32, y = target.pos.y*64+30;
        g.moveTo(actor.pos.x*64+32,actor.pos.y*64+30).lineTo(x,y).stroke({color:ATLAS.brass,width:crit?6:3});
        g.circle(x,y,crit?33:25).stroke({color:crit?ATLAS.brass:ATLAS.cream,width:crit?3:2});
        if (crit) for(let i=0;i<8;i++) {const angle=i*Math.PI/4;g.moveTo(x+Math.cos(angle)*25,y+Math.sin(angle)*25).lineTo(x+Math.cos(angle)*41,y+Math.sin(angle)*41).stroke({color:ATLAS.brass,width:2});}
        sweep.addChild(g); scene.effects.addChild(sweep); scene.feedback.push({node:sweep,start:now,duration:crit?500:350,originY:0,fixed:true});
      }
    }
    scene.previous = p.snapshot; scene.wasReplay = !!p.replayActive;
  }
  const badgeKey = (p.floatingBadges ?? []).map(b=>b.id).join('/');
  if (badgeKey !== scene.badgeKey) {
    for (const b of p.floatingBadges ?? []) feedback(scene,b.text,b.coord,b.color,now,!!p.reducedMotion);
    scene.badgeKey = badgeKey;
  }
  if (p.reducedMotion) { scene.motions.forEach(m=> { const a=m.path[m.path.length-1]!;m.node.position.set(a.x*64+32,a.y*64+26);if(m.dying)m.node.visible=false; }); scene.motions=[]; }
}

export function PixiBoard(props: Props) {
  const host = useRef<HTMLDivElement>(null), latest = useRef(props), scene = useRef<Scene | null>(null);
  latest.current = props;
  useEffect(() => {
    let disposed = false; let app: Application | null = null;
    const mount = async () => {
      const instance = new Application();
      const options = { width:BOARD_PIXEL_SIZE,height:BOARD_PIXEL_SIZE,backgroundColor:ATLAS.paper,antialias:true,resolution:Math.min(2,window.devicePixelRatio || 1),autoDensity:true };
      try { await instance.init({...options, preference:'webgl'}); }
      catch { await instance.init({...options, preference:'canvas'}); }
      if (disposed) { instance.destroy(true,{children:true}); return; }
      app=instance; instance.ticker.maxFPS=60;
      const canvas = instance.canvas; canvas.style.width = '100%'; canvas.style.height = 'auto'; canvas.dataset.testid='battle-canvas'; canvas.setAttribute('aria-label','10 by 10 tactical atlas. Arrow keys or WASD to inspect, Enter to act.'); canvas.setAttribute('role','img');
      host.current!.appendChild(canvas);
      const terrain=new Container(),hi=new Container(),units=new Container(),effects=new Container(),ambient=new Container();
      instance.stage.addChild(terrain,ambient,hi,units,effects);
      for (let i=0;i<12;i++) ambient.addChild(new Graphics().circle(20+i*53,(i*137)%640,1.6).fill(ATLAS.cream));
      const s:Scene={app:instance,terrain,highlights:hi,units,effects,ambient,previous:null,wasReplay:false,terrainKey:'',motions:[],feedback:[],badgeKey:''}; scene.current=s;
      const coord=(e:MouseEvent):Coord|null=> {const r=canvas.getBoundingClientRect(); const x=Math.floor((e.clientX-r.left)/r.width*10),y=Math.floor((e.clientY-r.top)/r.height*10); return x>=0&&x<10&&y>=0&&y<10?{x,y}:null;};
      let hovered = '';
      canvas.onpointermove = e => { const c = coord(e), next = c ? key(c) : ''; if (next !== hovered) { hovered = next; latest.current.onTileHover(c); } };
      canvas.onpointerleave = () => { hovered = ''; latest.current.onTileHover(null); };
      canvas.onclick = e => { const c = coord(e); if (c) latest.current.onTileClick(c); };
      update(s,latest.current);
      instance.ticker.add(()=> {
        const now=performance.now(), reduced=!!latest.current.reducedMotion;
        s.ambient.visible=!reduced;
        if (!reduced) { s.ambient.alpha=0.22+Math.sin(now/2200)*0.12; s.ambient.y=Math.sin(now/3500)*4; }
        s.motions=s.motions.filter(m=> {
          const t=Math.min(1,(now-m.start)/m.duration),a=pathPosition(m.path,easeOut(t));
          m.node.position.set(a.x*64+32+(m.hit&&!reduced?Math.sin(t*Math.PI*4)*(1-t)*3:0),a.y*64+26);
          if (m.dying) {m.node.alpha=1-t;m.node.scale.set(1-t*0.25);}
          return t<1;
        });
        s.feedback=s.feedback.filter(f=> {
          const t=(now-f.start)/f.duration;
          if(t>=1) {f.node.destroy({children:true});return false;}
          f.node.y=f.originY-(reduced||f.fixed?0:easeOut(t)*16); if(f.expand)f.node.scale.set(reduced?1:0.8+easeOut(t)*0.6); f.node.alpha=reduced?1:Math.min(1,(1-t)*3);return true;
        });
        if (canvas.dataset.animating !== String(s.motions.length)) canvas.dataset.animating=String(s.motions.length);
        if (canvas.dataset.reducedMotion !== String(reduced)) canvas.dataset.reducedMotion=String(reduced);
      });
    };
    void mount().catch(error => { if (!disposed && host.current) { host.current.textContent = `Unable to prepare the atlas: ${String(error)}`; host.current.setAttribute('role','alert'); } });
    return ()=> {disposed=true;scene.current=null;app?.destroy(true,{children:true});};
  },[]);
  useEffect(()=> {if(scene.current)update(scene.current,props);},[props.snapshot,props.cursor,props.threatTiles,props.activeMovePath,props.activeUnitId,props.floatingBadges,props.reducedMotion]);
  return <div ref={host} className="board-canvas-frame" />;
}
