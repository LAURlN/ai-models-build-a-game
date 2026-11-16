import { describe, expect, it } from 'vitest';
import { applyCommand, computeReachableTiles, computeStateHash, createInitialBattleState } from '../src/rules/battle';
import { artSeed, easeOut, isReducedMotion, pathPosition, terrainRecipe, unitRecipe, visualPath } from '../src/renderer/presentation';

describe('stateless atlas recipes', () => {
  it('recreates the same terrain and identities without consuming or mutating battle randomness', () => {
    const s = createInitialBattleState(371), before = computeStateHash(s);
    const first = s.terrain.map((row,y) => row.map((t,x) => terrainRecipe(s.seed,x,y,t)));
    expect(s.terrain.map((row,y) => row.map((t,x) => terrainRecipe(s.seed,x,y,t)))).toEqual(first);
    expect(terrainRecipe(372,0,0,'plain')).not.toEqual(first[0]![0]);
    expect(unitRecipe(s.units[0]!)).toEqual(unitRecipe(structuredClone(s.units[0]!)));
    expect(computeStateHash(s)).toBe(before);
    expect(artSeed('Alden')).toBe(artSeed('Alden'));
  });
  it('encodes factions and weapons separately; identity survives class and weapon changes', () => {
    const u = createInitialBattleState().units[0]!, a = unitRecipe(u);
    const b = unitRecipe({ ...u, classId: 'generated_astral_marshal', title: 'Astral Marshal', weapon: {...u.weapon, tag:'tome'}, faction:'enemy' });
    expect(b.factionShape).not.toBe(a.factionShape); expect(b.weapon).toBe('tome');
    expect([b.skin,b.hair]).toEqual([a.skin,a.hair]);
    const shapes = new Set(Array.from({length:50},(_,i) => {
      const r = unitRecipe({...u,classId:`generated_${i}`,title:`Class ${i}`});
      return `${r.helm}/${r.mantle}/${r.crest}/${r.trim}`;
    }));
    expect(shapes.size).toBeGreaterThan(40);
  });
});
describe('movement presentation follows legal terrain', () => {
  it('matches the kernel movement endpoints and cost, never crossing walls or enemies', () => {
    const s = createInitialBattleState(), u = s.units[0]!;
    for (const to of computeReachableTiles(s,u.id)) {
      const path = visualPath(s,u,to);
      expect(path[0]).toEqual(u.pos); expect(path.at(-1)).toEqual(to);
      let cost=0;
      path.slice(1).forEach((p,i) => {
        const prev=path[i]!;
        expect(Math.abs(p.x-prev.x)+Math.abs(p.y-prev.y)).toBe(1);
        expect(s.terrain[p.y]![p.x]).not.toBe('wall');
        expect(s.units.some(enemy=>enemy.alive && enemy.faction!==u.faction && enemy.pos.x===p.x && enemy.pos.y===p.y)).toBe(false);
        cost+=s.terrain[p.y]![p.x]==='cover'?2:1;
      });
      expect(cost).toBeLessThanOrEqual(u.mov);
      const resolved=applyCommand(s,{type:'MOVE_UNIT',unitId:u.id,to}); expect(resolved.ok).toBe(true);
    }
    expect(visualPath(s,u,{x:4,y:1})).toEqual([u.pos]);
  });
  it('clamps and eases path travel without cutting a corner', () => {
    const path=[{x:0,y:0},{x:1,y:0},{x:1,y:1}];
    expect(pathPosition(path,-1)).toEqual(path[0]); expect(pathPosition(path,2)).toEqual(path[2]);
    expect(pathPosition(path,.25)).toEqual({x:.5,y:0}); expect(pathPosition(path,.75)).toEqual({x:1,y:.5});
    expect(easeOut(0)).toBe(0); expect(easeOut(1)).toBe(1); expect(easeOut(.5)).toBeGreaterThan(.5);
  });
  it('respects the OS setting and explicit full/reduced overrides', () => {
    expect(isReducedMotion('system',true)).toBe(true); expect(isReducedMotion('system',false)).toBe(false);
    expect(isReducedMotion('full',true)).toBe(false); expect(isReducedMotion('reduced',false)).toBe(true);
  });
});
