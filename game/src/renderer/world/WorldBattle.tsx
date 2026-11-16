import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Forecast, SelectionInfo, AbilityInfo } from '../../engine/battle';
import { tileAt } from '../../engine/grid';
import type { BattleCommand, BattleSnapshot2, BattleState, CampaignState, Coord, FxCue, Loose, TraceStep } from '../../engine/types';
import { audio } from '../audio/audioEngine';
import { soundsForCues } from '../audio/sound';
import type { ViewRuntime } from './moduleRuntime';
import { ExtensionView, type PanelEnv } from './ui';
import { bodySvg } from './sprites';
import { WorldBoard } from './WorldBoard';

type Speed = 'slow' | 'normal' | 'fast';
const STEP_MS: Record<Speed, number> = { slow: 900, normal: 420, fast: 140 };
const MOTION: Record<Speed, number> = { slow: 1, normal: 0.65, fast: 0.25 };

interface Playback { ordinal: number; steps: TraceStep[]; index: number; display: BattleState }

function applyStep(base: BattleState, step: TraceStep): BattleState {
  const next = structuredClone(base);
  for (const d of step.after) {
    const u = next.units.find((x) => x.id === d.id);
    if (!u) continue;
    u.hp = d.hp; u.pos = { ...d.pos }; u.alive = d.alive; u.statuses = d.statuses; u.acts = d.acts;
    if (d.gone) u.gone = d.gone;
  }
  return next;
}

const sameCell = (a: Coord, b: Coord): boolean => a.x === b.x && a.y === b.y;
const GLYPHS: Record<string, string> = {
  orb: '◍', eye: '◉', shield: '⛉', bolt: 'ϟ', net: '⌗', star: '✦', leaf: '❦', whistle: '♪', fang: 'ᴧ', spear: '↟', sling: '➶', gun: '➵',
  claw: '⫽', hook: '⌐', staff: '⟊', fire: '✺', heal: '✚', wind: '≋', water: '≈', skull: '☠', sun: '☼', moon: '☾', music: '♫', key: '⚷',
};
/** Glyph names from content become symbols; any short symbol passes through; long words are dropped. */
export const glyphText = (glyph: string): string => GLYPHS[glyph] ?? ([...glyph].length <= 2 ? glyph : '');

function Portrait({ unit, size = 52 }: { unit: Loose; size?: number }) {
  // bodySvg only interpolates validated colours and numbers.
  return <span className="world-portrait" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: bodySvg(unit, size) }} />;
}

export interface WorldBattleProps {
  snapshot: BattleSnapshot2;
  campaign: CampaignState;
  runtime: ViewRuntime;
  reducedMotion: boolean;
  onResolve: () => Promise<void>;
  panelEnv: (battle: BattleState, selected: string | null) => PanelEnv;
}

export function WorldBattle({ snapshot, campaign, runtime, reducedMotion, onResolve, panelEnv }: WorldBattleProps) {
  const api = window.chronicleApi.world;
  const live = snapshot.state;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [ability, setAbility] = useState<AbilityInfo | null>(null);
  const [hover, setHover] = useState<Coord | null>(null);
  const [cursor, setCursor] = useState<Coord | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [preview, setPreview] = useState('');
  const [threat, setThreat] = useState<Coord[]>([]);
  const [danger, setDanger] = useState(false);
  const [speed, setSpeed] = useState<Speed>('normal');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [panel, setPanel] = useState<string>('unit');
  const [resolving, setResolving] = useState(false);
  const lastOrdinal = useRef(live.commandOrdinal);
  const previous = useRef<BattleState>(live);
  const [cueBatch, setCueBatch] = useState<{ key: string; list: FxCue[] }>({ key: `${live.id}:init`, list: [] });

  const playerFactions = useMemo(() => Object.values(live.factions).filter((f) => f.controller === 'player').map((f) => f.id), [live.factions]);
  const emitCues = useCallback((key: string, list: FxCue[]) => {
    setCueBatch({ key, list });
    for (const id of soundsForCues(list, playerFactions)) audio.play(id);
  }, [playerFactions]);

  // New authoritative state: replay AI traces step by step, or show the command's effects at once.
  useEffect(() => {
    if (live.commandOrdinal === lastOrdinal.current) { previous.current = live; return; }
    lastOrdinal.current = live.commandOrdinal;
    if (live.trace && live.trace.length) {
      const first = live.trace[0]!;
      setPlayback({ ordinal: live.commandOrdinal, steps: live.trace, index: 0, display: applyStep(previous.current, first) });
      emitCues(`${live.id}:${live.commandOrdinal}:0`, first.fx);
    } else {
      setPlayback(null);
      emitCues(`${live.id}:${live.commandOrdinal}`, live.fx);
    }
    previous.current = live;
  }, [live, emitCues]);

  useEffect(() => {
    if (!playback) return;
    const timer = setTimeout(() => {
      const next = playback.index + 1;
      if (next >= playback.steps.length) { setPlayback(null); return; }
      const step = playback.steps[next]!;
      setPlayback({ ...playback, index: next, display: applyStep(playback.display, step) });
      emitCues(`${live.id}:${playback.ordinal}:${next}`, step.fx);
    }, STEP_MS[speed]);
    return () => clearTimeout(timer);
  }, [playback, speed, emitCues, live.id]);

  const display = playback?.display ?? live;
  const phaseFaction = live.factions[live.order[live.phaseIndex] ?? ''];
  const playerTurn = live.status === 'ongoing' && phaseFaction?.controller === 'player' && !playback;
  const mode = runtime.reg.modes[live.mode];
  const nonGrid = !!mode && mode.grid === false;

  const refreshSelection = useCallback(async (id: string | null) => {
    if (!id) { setSelection(null); return; }
    try { setSelection(await api.battleSelect(id)); } catch (e) { setError(String(e)); }
  }, [api]);
  useEffect(() => { void refreshSelection(selectedId); }, [selectedId, snapshot.hash, refreshSelection]);
  useEffect(() => {
    let active = true;
    if (danger) void api.battleThreat().then((cells) => { if (active) setThreat(cells); }); else setThreat([]);
    return () => { active = false; };
  }, [danger, snapshot.hash, api]);
  useEffect(() => { if (selectedId && !live.units.some((u) => u.id === selectedId && u.alive)) { setSelectedId(null); setAbility(null); } }, [live, selectedId]);

  const send = useCallback(async (cmd: BattleCommand) => {
    setBusy(true); setError(null);
    try {
      const result = await api.battleCommand(cmd);
      if (!result.ok) { setError(result.error); audio.play('ui.deny'); }
      setForecast(null); setPreview('');
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }, [api]);

  const hovered = hover ?? cursor;
  const hoveredUnit = hovered ? display.units.find((u) => u.alive && sameCell(u.pos, hovered)) : undefined;
  const target = hoveredUnit && selection?.targets.find((t) => t.id === hoveredUnit.id);

  useEffect(() => {
    let active = true;
    setForecast(null);
    if (selectedId && target && !ability && !playback) {
      void api.battleForecast(selectedId, target.id, target.weapon, target.from).then((f) => { if (active) setForecast(f); });
    }
    return () => { active = false; };
  }, [selectedId, target?.id, target?.weapon, target?.from?.x, target?.from?.y, ability, playback, snapshot.hash, api]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let active = true;
    setPreview('');
    if (selectedId && ability && hovered) {
      const unit = live.units.find((u) => u.alive && sameCell(u.pos, hovered));
      const valid = ability.target === 'unit' ? !!unit && ability.unitIds.includes(unit.id) : ability.cells.some((c) => sameCell(c, hovered));
      if (valid) void api.battlePreview(selectedId, ability.id, ability.target === 'unit' ? unit!.id : hovered).then((text) => { if (active) setPreview(text); });
    }
    return () => { active = false; };
  }, [selectedId, ability, hovered?.x, hovered?.y, api, live.units]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = (id: string | null): void => { setSelectedId(id); setAbility(null); if (id) audio.play('ui.select'); };

  const clickTile = useCallback((c: Coord) => {
    if (busy || playback || live.status !== 'ongoing') return;
    const unit = live.units.find((u) => u.alive && sameCell(u.pos, c));
    if (ability && selectedId) {
      if (ability.target === 'unit' && unit && ability.unitIds.includes(unit.id)) { void send({ type: 'ability', unit: selectedId, ability: ability.id, target: unit.id }); setAbility(null); return; }
      if (ability.target === 'tile' && ability.cells.some((o) => sameCell(o, c))) { void send({ type: 'ability', unit: selectedId, ability: ability.id, target: c }); setAbility(null); return; }
      setAbility(null); audio.play('ui.deny'); return;
    }
    if (unit && playerFactions.includes(unit.faction)) { select(selectedId === unit.id ? null : unit.id); return; }
    if (selectedId && unit && selection) {
      const t = selection.targets.find((x) => x.id === unit.id);
      // Immediate resolution, no confirm; out of reach targets are bump-attacked from the best tile.
      if (t) { void send({ type: 'attack', unit: selectedId, target: unit.id, weapon: t.weapon, ...(t.from ? { from: t.from } : {}) }); return; }
    }
    if (selectedId && selection?.reachable.some((r) => sameCell(r, c))) { void send({ type: 'move', unit: selectedId, to: c }); return; }
    if (unit) select(unit.id); else select(null);
  }, [busy, playback, live, ability, selectedId, selection, playerFactions, send]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || (e.target instanceof Element && e.target.closest('button,input,textarea,select,a,.ext-host'))) return;
      const dirs: Record<string, [number, number]> = { ArrowUp: [0, -1], w: [0, -1], ArrowRight: [1, 0], d: [1, 0], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0] };
      const delta = dirs[e.key];
      if (delta) {
        e.preventDefault();
        const start = cursor ?? live.units.find((u) => u.id === selectedId)?.pos ?? live.units.find((u) => u.alive && playerFactions.includes(u.faction))?.pos ?? { x: 0, y: 0 };
        setCursor({ x: Math.max(0, Math.min(live.map.width - 1, start.x + delta[0])), y: Math.max(0, Math.min(live.map.height - 1, start.y + delta[1])) });
      } else if ((e.key === 'Enter' || e.key === ' ') && cursor) { e.preventDefault(); clickTile(cursor); }
      else if (e.key === 'Escape') { setAbility(null); select(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cursor, clickTile, live, selectedId, playerFactions]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = display.units.find((u) => u.id === selectedId && u.alive) ?? null;
  const inspected = selected ?? hoveredUnit ?? null;
  const path = useMemo(() => {
    if (!selected || !selection || !hovered || ability) return [];
    const dest = target?.from ?? (selection.reachable.some((r) => sameCell(r, hovered)) ? hovered : null);
    if (!dest) return [];
    // Straight-line preview between the unit and its destination; the engine resolves the real path.
    const out: Coord[] = [{ ...selected.pos }];
    let { x, y } = selected.pos;
    while (x !== dest.x) { x += Math.sign(dest.x - x); out.push({ x, y }); }
    while (y !== dest.y) { y += Math.sign(dest.y - y); out.push({ x, y }); }
    return out;
  }, [selected, selection, hovered, target, ability]);

  const factions = Object.values(live.factions);
  const tile = hovered ? tileAt(live.map, hovered.x, hovered.y) : null;
  const step = playback ? playback.steps[playback.index] : null;
  const panels = runtime.reg.panels.filter((p) => p.scope === 'battle' || p.scope === 'both');
  const env = panelEnv(display, selectedId);

  return (
    <main className="world-battle" data-testid="world-battle" data-status={live.status} data-outcome={live.outcome ?? ''} data-mode={live.mode}>
      <section className="world-battle-main">
        <div className="field-heading">
          <div><span className="eyebrow">ROUND {live.round}{live.objective.turnLimit ? ` / ${live.objective.turnLimit}` : ''} · {nonGrid ? (mode?.name ?? live.mode).toUpperCase() : `${live.map.width}×${live.map.height} · ${live.units.filter((u) => u.alive).length} ON THE FIELD`}</span>
            <h2 data-testid="world-battle-title">{live.title}</h2></div>
          <span className={`phase-ribbon ${phaseFaction?.controller === 'player' ? 'phase-player' : 'phase-enemy'}`} key={`${live.round}/${live.phaseIndex}`} role="status" data-testid="world-phase">
            {phaseFaction?.controller === 'player' ? '◇' : '◆'} {phaseFaction?.name ?? '—'}
          </span>
        </div>
        <div className="world-objective" data-testid="world-objective">◎ {live.objective.text}</div>
        <div className="board-toolbar">
          <button className="btn btn-primary btn-compact" data-testid="world-end-phase" disabled={!playerTurn || busy} onClick={() => void send({ type: 'endPhase' })}>End phase</button>
          <button className="btn btn-secondary btn-compact" data-testid="world-rewind" disabled={busy || !snapshot.canRewind || !!playback} onClick={() => void api.battleRewind().catch((e) => setError(String(e)))}>Turnwheel ({snapshot.rewindsLeft})</button>
          {!nonGrid && <button className={`btn btn-compact ${danger ? 'btn-danger' : 'btn-ghost'}`} data-testid="world-danger" onClick={() => setDanger((v) => !v)}>Danger zone: {danger ? 'on' : 'off'}</button>}
          <label className="speed-control">Replay<select data-testid="world-speed" value={speed} onChange={(e) => setSpeed(e.target.value as Speed)}><option value="slow">Slow</option><option value="normal">Normal</option><option value="fast">Fast</option></select></label>
          <button className="btn btn-ghost btn-compact" data-testid="world-retreat" disabled={busy || live.status !== 'ongoing'} onClick={() => void send({ type: 'retreat' })}>Retreat</button>
          <span className="legend-hash" title="Simulation hash">{snapshot.hash}</span>
        </div>
        {(playback || (live.status === 'ongoing' && phaseFaction?.controller !== 'player')) && (
          <div className="enemy-playback-bar" data-testid="world-playback">
            <div className="enemy-playback-text"><strong>{playback ? `Other forces act (${playback.index + 1}/${playback.steps.length})` : 'Other forces are moving…'}</strong>
              <span role="status" aria-live="polite" data-testid="world-playback-step">{step?.summary ?? ''}</span></div>
            {playback && <button className="btn btn-secondary btn-compact" data-testid="world-skip" onClick={() => setPlayback(null)}>Skip</button>}
          </div>
        )}
        {error && <div className="error-banner" role="alert"><span>{error}</span><button className="btn btn-compact" onClick={() => setError(null)}>Dismiss</button></div>}
        {nonGrid ? (
          mode?.view ? <ExtensionView moduleId={mode.module} testId="world-mode-view" render={mode.view.render} env={env} /> : <p className="muted-copy">The {mode?.name} mode has no view.</p>
        ) : (
          <WorldBoard
            state={display} reg={runtime.reg} selectedId={selectedId}
            reachable={ability ? [] : selection?.reachable ?? []} attackCells={ability ? [] : selection?.attackCells ?? []}
            targetIds={ability ? ability.unitIds : selection?.targets.map((t) => t.id) ?? []} abilityCells={ability?.cells ?? []}
            threat={threat} cursor={hovered} path={path} cues={cueBatch} reducedMotion={reducedMotion} speed={playback ? MOTION[speed] : 1}
            onTileClick={clickTile} onTileHover={setHover}
          />
        )}
        {!nonGrid && <div className="board-legend">
          <span className="legend-item"><span className="swatch swatch-move" /> Move</span>
          <span className="legend-item"><span className="swatch swatch-attack" /> Targets · danger</span>
          <span className="legend-item"><span className="swatch swatch-select" /> Selected · objective · ability</span>
          {tile && <span data-testid="world-tile-info">{tile.name}{tile.blocksMove ? ' · impassable' : ` · move ${tile.cost}`}{tile.defense ? ` · +${tile.defense} def` : ''}{tile.avoid ? ` · ${tile.avoid > 0 ? '+' : ''}${tile.avoid} avoid` : ''}{tile.description ? ` — ${tile.description}` : ''}</span>}
          <span>Drag to pan · wheel to zoom · double-click to fit</span>
        </div>}
      </section>

      <aside className="world-battle-side">
        <div className="side-tabs" role="tablist">
          {[['unit', 'Unit'], ['forces', 'Forces'], ['log', 'Log'], ...panels.map((p) => [`panel:${p.id}`, `${p.icon} ${p.title}`])].map(([id, title]) => (
            <button key={id} role="tab" aria-selected={panel === id} className={`side-tab ${panel === id ? 'is-active' : ''}`} data-testid={`battle-tab-${id}`} onClick={() => setPanel(id!)}>{title}</button>
          ))}
        </div>
        {panel === 'unit' && (
          <>
            {inspected ? (
              <section className="panel world-unit" data-testid="world-unit-card">
                <div className="inspection-heading"><Portrait unit={inspected} />
                  <div className="inspection-title"><span className="eyebrow">{live.factions[inspected.faction]?.name ?? inspected.faction} · {inspected.acts > 0 ? 'READY' : '✓ SPENT'}</span>
                    <h2>{inspected.name}</h2><span className="muted-copy">{inspected.title} · L{inspected.level}</span>
                    <span className="unit-badge">{inspected.hp}/{inspected.maxHp} HP · MOV {inspected.mov}{inspected.moveType !== 'foot' ? ` (${inspected.moveType})` : ''}</span></div></div>
                <div className="unit-stats">{Object.entries(inspected.stats).map(([k, v]) => <span key={k}>{k.toUpperCase()} {v}</span>)}{Object.entries(inspected.resources).map(([k, v]) => <span key={k}>{k} {v}</span>)}</div>
                {inspected.statuses.length > 0 && <div className="world-chips">{inspected.statuses.map((st) => {
                  const def = runtime.reg.statuses[st.id] ?? (live.vars.__inline?.statuses?.[st.id] as Loose);
                  return <span key={st.id} className={`status-chip tone-${def?.tone ?? 'neutral'}`} title={def?.description ?? ''}>{def?.name ?? st.id}{st.stacks > 1 ? ` ×${st.stacks}` : ''}{st.duration > 0 ? ` · ${st.duration}` : ''}</span>;
                })}</div>}
                <div className="world-weapons">{inspected.weapons.map((w, i) => (
                  <div key={i} className={`world-weapon ${i === inspected.equipped ? 'is-equipped' : ''}`} title={w.description}>
                    <strong>{w.name}</strong> <span className="muted-copy">{w.kind} · rng {w.range[0]}–{w.range[1]} · mt {w.might} · hit {w.hit}{w.crit ? ` · crit ${w.crit}` : ''} · {w.damageType}{w.area ? ` · ${w.area.shape} ${w.area.size}` : ''}</span>
                  </div>))}
                </div>
                {selected && selection && selected.id === inspected.id && (
                  <div className="selected-actions">
                    {selection.abilities.map((a) => (
                      <button key={a.id} className={`btn btn-compact ${ability?.id === a.id ? 'btn-primary' : a.target === 'passive' ? 'btn-ghost' : 'btn-secondary'}`} data-testid={`world-ability-${a.id}`}
                        disabled={!a.enabled || !playerTurn} title={`${a.description}${a.cost ? ` (${a.cost})` : ''}${a.reason ? ` — ${a.reason}` : ''}`}
                        onClick={() => {
                          if (a.target === 'self' || a.target === 'none') void send({ type: 'ability', unit: selected.id, ability: a.id });
                          else setAbility(ability?.id === a.id ? null : a);
                        }}>{glyphText(a.glyph) ? `${glyphText(a.glyph)} ` : ''}{a.name}{a.faulted ? ' ⚠' : ''}</button>
                    ))}
                    <button className="btn btn-compact" data-testid="world-wait" disabled={!playerTurn || !selection.canAct} onClick={() => void send({ type: 'wait', unit: selected.id })}>Wait</button>
                  </div>
                )}
                {selected && selection && selected.id === inspected.id && selection.abilities.length > 0 && (
                  <details className="ability-text"><summary>Abilities</summary>{selection.abilities.map((a) => <p key={a.id}><strong>{a.name}</strong> — {a.description} <em>{a.cost}{a.reason && a.target !== 'passive' ? ` · ${a.reason}` : ''}</em></p>)}</details>
                )}
                {ability && <p className="muted-copy" data-testid="world-ability-prompt">Choose a {ability.target === 'unit' ? 'highlighted unit' : 'marked tile'} for {ability.name}. Esc cancels.{preview ? ` ${preview}.` : ''}</p>}
              </section>
            ) : <section className="panel"><p className="muted-copy">Select one of your units. Hover anything to inspect it.</p></section>}
            {forecast && (
              <section className="panel forecast-panel" data-testid="world-forecast">
                <h2>Forecast · {forecast.attacker.name} → {forecast.target.name}</h2>
                <div className="forecast-numbers">
                  <span><strong>{forecast.attacker.damage}</strong>dmg{forecast.attacker.strikes > 1 ? ' ×2' : ''}</span><span><strong>{forecast.attacker.hit}%</strong>hit</span><span><strong>{forecast.attacker.crit}%</strong>crit</span>
                  {forecast.defender ? <><span><strong>{forecast.defender.damage}</strong>counter{forecast.defender.strikes > 1 ? ' ×2' : ''}</span><span><strong>{forecast.defender.hit}%</strong>hit</span></> : null}
                </div>
                <p className="muted-copy">{forecast.target.name}: {forecast.target.hp}/{forecast.target.maxHp} HP · {forecast.attacker.weapon}{forecast.defender ? ` vs ${forecast.defender.weapon}` : ''}. Click to strike now{target?.from ? ' (moves first)' : ''}; the Turnwheel can undo.</p>
                {forecast.notes.length > 0 && <ul className="world-notes">{forecast.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
              </section>
            )}
          </>
        )}
        {panel === 'forces' && (
          <section className="panel world-forces" data-testid="world-forces">
            {factions.map((f) => {
              const members = display.units.filter((u) => u.faction === f.id);
              return (
                <details key={f.id} open={f.controller === 'player' || members.length <= 12}>
                  <summary><span className="faction-dot" style={{ background: f.color }} /> {f.name} · {members.filter((u) => u.alive).length}/{members.length} standing</summary>
                  <div className="world-unit-list">{members.map((u) => (
                    <button key={u.id} className={`world-unit-row ${u.alive ? '' : 'is-down'} ${u.id === selectedId ? 'is-selected' : ''}`} onClick={() => u.alive && select(u.id)} data-testid={`world-unit-${u.id}`}>
                      <span>{u.name}</span><span className="hp-mini"><span style={{ width: `${(u.hp * 100) / u.maxHp}%` }} /></span><span>{u.alive ? `${u.hp}/${u.maxHp}` : u.gone ?? 'down'}</span>
                    </button>))}
                  </div>
                </details>
              );
            })}
          </section>
        )}
        {panel === 'log' && (
          <section className="panel log-panel world-log"><ul className="event-log" data-testid="world-log">{[...live.log].slice(-80).reverse().map((e) => <li key={e.id} className={`log-item log-${e.kind}`}><span className="log-turn">R{e.round}</span>{e.text}</li>)}</ul></section>
        )}
        {panels.map((p) => panel === `panel:${p.id}` && (
          <section key={p.id} className="panel"><ExtensionView moduleId={p.module} testId={`ext-panel-${p.id}`} render={p.render} env={env} /></section>
        ))}
        <section className="panel world-campaign-mini"><span className="eyebrow">{campaign.title}</span><p className="muted-copy">{live.intro}</p></section>
      </aside>

      {live.status === 'ended' && !playback && (
        <div className="end-overlay" role="dialog" aria-modal="true" data-testid="world-end-screen" data-outcome={live.outcome ?? ''}>
          <div className={`end-modal outcome-${live.outcome === 'victory' ? 'victory' : 'defeat'}`}>
            <span className="eyebrow">THE CHRONICLE REMEMBERS</span>
            <h2 data-testid="world-end-title">{(live.outcome ?? 'ended').toUpperCase()}</h2>
            <p className="end-reason">{live.endReason}</p>
            <div className="ending-record">Round {live.round} · {live.units.filter((u) => playerFactions.includes(u.faction) && u.alive).length} of yours standing
              {live.result.captured.length > 0 && <><br />Captured: {live.result.captured.map((u: Loose) => u.name).join(', ')}</>}
              {live.result.loot.length > 0 && <><br />Loot: {live.result.loot.map((l) => `${l.name} ×${l.qty}`).join(', ')}</>}
              <br />{live.units.filter((u) => playerFactions.includes(u.faction) && !u.alive && !u.gone).map((u) => u.name).join(' · ') || 'No companions lost'}</div>
            <div className="end-actions">
              <button className="btn btn-primary" data-testid="world-resolve" disabled={resolving} onClick={() => { setResolving(true); void onResolve().finally(() => setResolving(false)); }}>Return to the story</button>
              {snapshot.canRewind && <button className="btn btn-secondary" data-testid="world-end-rewind" onClick={() => void api.battleRewind().catch((e) => setError(String(e)))}>Turnwheel ({snapshot.rewindsLeft})</button>}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
