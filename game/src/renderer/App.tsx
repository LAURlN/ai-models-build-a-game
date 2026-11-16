import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { combatNumbers, computeFactionThreatTiles } from '../rules/battle';
import { RULES, abilityTooltip } from '../rules/ir';
import type {
  BattleSnapshot,
  BattleState,
  CombatForecast,
  Coord,
  EnemyPhaseStep,
  GameCommand,
} from '../shared/contracts';
import { CampaignScreen } from './components/CampaignScreen';
import { PixiBoard, type FloatingBadge } from './components/PixiBoard';
import { AtlasArt, Portrait } from './components/AtlasArt';
import { isReducedMotion, type MotionPreference } from './presentation';
import { ProvidersScreen } from './components/ProvidersScreen';
import { StoryScreen } from './world/StoryScreen';
import { audio } from './audio/audioEngine';
import { loadSoundSettings, moodFor, saveSoundSettings, type SoundSettings } from './audio/sound';
import type { WorldView } from '../engine/types';

type AppTab = 'menu' | 'story' | 'battle' | 'campaign' | 'providers' | 'settings';
type EnemySpeed = 'slow' | 'normal' | 'fast';

const SPEED_MS: Record<EnemySpeed, number> = {
  slow: 750,
  normal: 320,
  fast: 110,
};

interface EnemyPlaybackState {
  active: boolean;
  steps: EnemyPhaseStep[];
  stepIndex: number;
  displayState: BattleState;
  activeMovePath: Coord[];
  activeUnitId: string | null;
  commandOrdinal: number;
}

function applyEnemyStepToVisualState(base: BattleState, step: EnemyPhaseStep): BattleState {
  const next = structuredClone(base);
  const actor = next.units.find((u) => u.id === step.actorId);
  if (actor) {
    if (step.kind === 'move' && step.to) {
      actor.pos = { ...step.to };
    }
    if (step.kind === 'attack') actor.hasActed = true;
    actor.hp = step.hpAfter;
    actor.alive = step.hpAfter > 0;
  }
  if (step.targetId && step.targetHpAfter !== undefined) {
    const target = next.units.find((u) => u.id === step.targetId);
    if (target) {
      target.hp = step.targetHpAfter;
      target.alive = step.targetHpAfter > 0;
    }
  }
  if (step.kind === 'attack') {
    for (const strike of step.strikes ?? []) {
      const attacker = next.units.find(u => u.id === strike.actorId);
      const target = next.units.find(u => u.id === strike.targetId);
      if (attacker && target) next.events.push({ id: -1 - next.events.filter(e => e.id < 0).length,
        kind: 'attack', turn: next.turn, phase: 'enemy',
        message: `${attacker.name} → ${target.name}: ${strike.role} ${strike.outcome};` });
    }
  }
  if (step.kind === 'status' && actor) {
    actor.statuses = [];
  }
  return next;
}

function stepFloatingBadge(state: BattleState, step: EnemyPhaseStep): FloatingBadge | null {
  if (step.kind === 'status') {
    const actor = state.units.find((u) => u.id === step.actorId);
    if (!actor) return null;
    return {
      id: `enemy-step:${step.id}`,
      coord: actor.pos,
      text: 'Status expiry',
      color: 0xb45309,
    };
  }
  return null;
}

export function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('menu');
  const [motionPreference, setMotionPreference] = useState<MotionPreference>(() => {
    const saved = localStorage.getItem('chronicle-motion');
    return saved === 'full' || saved === 'reduced' ? saved : 'system';
  });
  const [systemReduced, setSystemReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [largeText, setLargeText] = useState(() => localStorage.getItem('chronicle-large-text') === 'true');
  const reducedMotion = isReducedMotion(motionPreference, systemReduced);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setSystemReduced(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => { localStorage.setItem('chronicle-motion', motionPreference); }, [motionPreference]);
  const [sound, setSound] = useState<SoundSettings>(() => loadSoundSettings(localStorage));
  const [worldView, setWorldView] = useState<WorldView | null>(null);
  useEffect(() => { saveSoundSettings(localStorage, sound); audio.configure(sound, reducedMotion); }, [sound, reducedMotion]);
  useEffect(() => {
    // Browsers only allow audio after a gesture; every button press also gets a soft click.
    const unlock = (e: Event) => { audio.unlock(); if (e.type === 'click' && e.target instanceof Element && e.target.closest('button')) audio.play('ui.click'); };
    window.addEventListener('pointerdown', unlock, true); window.addEventListener('keydown', unlock, true); window.addEventListener('click', unlock, true);
    return () => { window.removeEventListener('pointerdown', unlock, true); window.removeEventListener('keydown', unlock, true); window.removeEventListener('click', unlock, true); };
  }, []);
  useEffect(() => {
    audio.setMood(activeTab === 'story' ? moodFor(worldView) : activeTab === 'battle' ? 'battle' : activeTab === 'campaign' ? 'tense' : 'story');
  }, [activeTab, worldView]);
  useEffect(() => () => audio.dispose(), []);
  useEffect(() => { localStorage.setItem('chronicle-large-text', String(largeText)); document.documentElement.style.fontSize = largeText ? '18px' : '16px'; }, [largeText]);
  const [snapshot, setSnapshot] = useState<BattleSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const [cursor, setCursor] = useState<Coord | null>(null);
  const [hover, setHover] = useState<Coord | null>(null);
  const [attackMode, setAttackMode] = useState(false);
  const [forecast, setForecast] = useState<CombatForecast | null>(null);
  const [showDangerZone, setShowDangerZone] = useState(false);
  const [enemySpeed, setEnemySpeed] = useState<EnemySpeed>('normal');
  const speedRef = useRef<EnemySpeed>('normal');
  speedRef.current = enemySpeed;

  const [playback, setPlayback] = useState<EnemyPlaybackState | null>(null);
  const [floatingBadges, setFloatingBadges] = useState<FloatingBadge[]>([]);
  const badgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const prevSnapshotRef = useRef<BattleSnapshot | null>(null);
  const lastReplayedOrdinalRef = useRef<number>(-1);

  const pushBadge = useCallback((badge: FloatingBadge, durationMs = 1500) => {
    if (badgeTimerRef.current) clearTimeout(badgeTimerRef.current);
    setFloatingBadges([badge]);
    badgeTimerRef.current = setTimeout(() => {
      setFloatingBadges([]);
      badgeTimerRef.current = null;
    }, durationMs);
  }, []);

  const accept = useCallback(
    (next: BattleSnapshot) => {
      setSnapshot((old) => {
        // IPC replies and subscription updates can carry the same boundary.
        // Preserve the running piece animation when its duplicate arrives.
        if (old && next.revision <= old.revision) return old;
        const prev = old ?? prevSnapshotRef.current;

        // Detect newly resolved enemy phase trace
        const trace = next.state.enemyPhaseTrace;
        if (
          trace &&
          trace.length > 0 &&
          next.state.commandOrdinal > lastReplayedOrdinalRef.current &&
          prev &&
          next.state.commandOrdinal > prev.state.commandOrdinal
        ) {
          lastReplayedOrdinalRef.current = next.state.commandOrdinal;
          const initialVisual = structuredClone(prev.state);
          initialVisual.phase = 'enemy';
          const firstStep = trace[0]!;
          const afterFirst = applyEnemyStepToVisualState(initialVisual, firstStep);
          const firstBadge = stepFloatingBadge(afterFirst, firstStep);
          if (firstBadge) setFloatingBadges([firstBadge]);
          setPlayback({
            active: true,
            steps: trace,
            stepIndex: 0,
            displayState: afterFirst,
            activeMovePath: firstStep.path ? [firstStep.from ?? firstStep.path[0]!, ...firstStep.path] : [],
            activeUnitId: firstStep.actorId,
            commandOrdinal: next.state.commandOrdinal,
          });
        } else if (prev && next.state.commandOrdinal !== prev.state.commandOrdinal) {
          // Emit concise visual feedback badge for player ability / combat resolution
          const newEvents = next.state.events.slice(prev.state.events.length);
          const abilityRule = newEvents.find((ev) => ev.kind === 'rule' && ev.message.includes('useActive'));
          if (abilityRule) {
            const actor = next.state.units.find((u) => u.id === prev.state.selectedUnitId && u.alive);
            if (actor) {
              pushBadge({
                id: `ability:${next.state.commandOrdinal}`,
                coord: actor.pos,
                text: `${abilityRule.message.split(' — ')[0]} (+1 Act)`,
                color: 0xb45309,
              });
            }
          }
        }

        prevSnapshotRef.current = next;
        return next;
      });
    },
    [pushBadge],
  );

  // Advance Enemy Phase visual playback timer
  useEffect(() => {
    if (!playback?.active) return;
    const delay = SPEED_MS[speedRef.current];
    const timer = setTimeout(() => {
      setPlayback((curr) => {
        if (!curr || !curr.active) return null;
        const nextIdx = curr.stepIndex + 1;
        if (nextIdx >= curr.steps.length) {
          setFloatingBadges([]);
          return null;
        }
        const step = curr.steps[nextIdx]!;
        const nextVisual = applyEnemyStepToVisualState(curr.displayState, step);
        const badge = stepFloatingBadge(nextVisual, step);
        setFloatingBadges(badge ? [badge] : []);
        return {
          ...curr,
          stepIndex: nextIdx,
          displayState: nextVisual,
          activeMovePath: step.path ? [step.from ?? step.path[0]!, ...step.path] : [],
          activeUnitId: step.actorId,
        };
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [playback, enemySpeed]);

  const skipEnemyPlayback = useCallback(() => {
    setPlayback(null);
    setFloatingBadges([]);
  }, []);

  useEffect(() => {
    let active = true;
    void window.chronicleApi
      .getSnapshot()
      .then((s) => {
        if (active) accept(s);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    const unsubscribe = window.chronicleApi.onSnapshot((s) => {
      if (active) {
        setAttackMode(false);
        setForecast(null);
        accept(s);
      }
    });
    return () => {
      active = false;
      unsubscribe();
      if (badgeTimerRef.current) clearTimeout(badgeTimerRef.current);
    };
  }, [accept]);

  const operation = useCallback(
    async (action: () => Promise<BattleSnapshot>, message = '') => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      setNotice('');
      setAttackMode(false);
      setForecast(null);
      skipEnemyPlayback();
      try {
        const resultSnap = await action();
        accept(resultSnap);
        setNotice(message);
      } catch (e) {
        setError(String(e));
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [accept, skipEnemyPlayback],
  );

  const send = useCallback(
    (cmd: GameCommand) =>
      operation(async () => {
        const res = await window.chronicleApi.dispatch(cmd);
        if (!res.ok && res.error) {
          setError(res.error);
        }
        return res.snapshot;
      }),
    [operation],
  );

  const selectedId = snapshot?.state.selectedUnitId ?? null;
  const activeCoord = hover ?? cursor;
  const hoveredUnit = snapshot?.state.units.find(
    (u) => u.alive && activeCoord && u.pos.x === activeCoord.x && u.pos.y === activeCoord.y,
  );
  const hoveredAttackableTargetId =
    hoveredUnit &&
    hoveredUnit.faction === 'enemy' &&
    snapshot?.attackableTargetIds.includes(hoveredUnit.id)
      ? hoveredUnit.id
      : null;

  useEffect(() => {
    let active = true;
    setForecast(null);
    if (selectedId && hoveredAttackableTargetId && !playback?.active) {
      void window.chronicleApi
        .forecast(selectedId, hoveredAttackableTargetId)
        .then((f) => {
          if (active) setForecast(f);
        })
        .catch((e) => {
          if (active) setError(String(e));
        });
    }
    return () => {
      active = false;
    };
  }, [selectedId, hoveredAttackableTargetId, snapshot?.stateHash, playback?.active]);

  const clickTile = useCallback(
    (coord: Coord) => {
      if (
        !snapshot ||
        busy ||
        playback?.active ||
        snapshot.state.status !== 'ongoing' ||
        snapshot.state.phase !== 'player'
      ) {
        return;
      }
      const u = snapshot.state.units.find((unit) => unit.alive && unit.pos.x === coord.x && unit.pos.y === coord.y);
      if (u?.faction === 'player') {
        void send({ type: 'SELECT_UNIT', unitId: selectedId === u.id ? null : u.id });
        return;
      }
      if (selectedId && u && snapshot.attackableTargetIds.includes(u.id)) {
        // Immediate attack resolution on click (or bump-attack): no confirmation modal!
        void send({ type: 'ATTACK_UNIT', attackerId: selectedId, targetId: u.id });
        return;
      }
      if (selectedId && snapshot.reachableTiles.some((c) => c.x === coord.x && c.y === coord.y)) {
        void send({ type: 'MOVE_UNIT', unitId: selectedId, to: coord });
      }
    },
    [snapshot, busy, playback?.active, selectedId, send],
  );

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        activeTab !== 'battle' ||
        !snapshot ||
        e.repeat ||
        (e.target instanceof Element && e.target.closest('button,input,textarea,select,a'))
      ) {
        return;
      }
      const directions: Record<string, [number, number]> = {
        ArrowUp: [0, -1],
        w: [0, -1],
        ArrowRight: [1, 0],
        d: [1, 0],
        ArrowDown: [0, 1],
        s: [0, 1],
        ArrowLeft: [-1, 0],
        a: [-1, 0],
      };
      const delta = directions[e.key];
      if (delta) {
        e.preventDefault();
        setCursor((old) => ({
          x: Math.max(0, Math.min(9, (old?.x ?? 1) + delta[0])),
          y: Math.max(0, Math.min(9, (old?.y ?? 2) + delta[1])),
        }));
      } else if ((e.key === 'Enter' || e.key === ' ') && cursor) {
        e.preventDefault();
        clickTile(cursor);
      } else if (e.key === 'Escape') {
        setAttackMode(false);
        setForecast(null);
        void send({ type: 'SELECT_UNIT', unitId: null });
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [activeTab, snapshot, cursor, clickTile, send]);

  const displaySnapshot: BattleSnapshot | null = useMemo(() => {
    if (!snapshot) return null;
    if (!playback?.active) return snapshot;
    return {
      ...snapshot,
      state: playback.displayState,
      reachableTiles: [],
      attackableTargetIds: [],
    };
  }, [snapshot, playback]);

  const threatTiles = useMemo(() => {
    if (!displaySnapshot || !showDangerZone) return [];
    return computeFactionThreatTiles(displaySnapshot.state, 'enemy');
  }, [displaySnapshot, showDangerZone]);

  if (!snapshot || !displaySnapshot) {
    return (
      <div className="loading-shell">
        <p role={error ? 'alert' : undefined}>{error ?? 'Preparing tactical board…'}</p>
      </div>
    );
  }

  const { state } = snapshot;
  const visualState = displaySnapshot.state;
  const pack = state.rulePack ?? RULES;
  const selected = state.units.find((u) => u.id === selectedId && u.alive);
  const inspectedUnit = selected ?? hoveredUnit ?? null;
  const player = !busy && !playback?.active && state.status === 'ongoing' && state.phase === 'player';

  const rewindButton = (
    <button
      className="btn btn-secondary"
      data-testid="rewind-btn"
      disabled={busy || !snapshot.canRewind}
      onClick={() =>
        void operation(() => window.chronicleApi.rewind(), 'Rewound to the previous player decision.')
      }
    >
      Turnwheel ({snapshot.rewindsLeft}/3)
    </button>
  );

  const objectiveLabel =
    state.objectiveType === 'seize' && state.seizeTile
      ? `Seize (${state.seizeTile.x}, ${state.seizeTile.y}) within ${state.maxTurns} turns`
      : `Rout all enemies within ${state.maxTurns} turns`;

  const showEnemyBanner = playback?.active || (state.status === 'ongoing' && state.phase === 'enemy');
  const currentEnemyStep = playback?.active ? playback.steps[playback.stepIndex] : null;

  return (
    <div className={`app-shell ${largeText ? 'large-text' : ''}`} aria-busy={busy} data-motion={reducedMotion ? 'reduced' : 'full'}>
      <header className="top-bar">
        <div className="brand-group">
          <div className="brand-row">
            <button className="brand-home" data-testid="tab-menu" onClick={() => setActiveTab('menu')}><span className="brand-mark">✦</span><span className="app-title">Chronicle Tactics</span></button>
            {activeTab === 'battle' && <span className="pill" data-testid="chapter-title-pill">
              {state.chapterTitle ?? 'Brass Ward'}
            </span>}
            {activeTab === 'battle' && state.chapterSource && state.chapterSource !== 'builtin' && (
              <span
                className={`pill ${
                  state.chapterSource === 'local_fallback' ? 'badge-fallback' : 'badge-generated'
                }`}
                data-testid="active-chapter-source"
              >
                {state.chapterSource === 'local_fallback' ? 'Local Fallback' : 'Generated'}
              </span>
            )}
          </div>
          <span className="subtitle">{activeTab === 'battle' ? objectiveLabel : 'A field atlas of unwritten worlds'}</span>
        </div>

        <nav className="nav-tabs" aria-label="Main Navigation">
          <button type="button" className={`btn ${activeTab === 'story' ? 'btn-primary' : 'btn-ghost'}`} data-testid="tab-story" onClick={() => setActiveTab('story')}>Campaigns</button>
          <button
            type="button"
            className={`btn ${activeTab === 'battle' ? 'btn-primary' : 'btn-ghost'}`}
            data-testid="tab-battle"
            onClick={() => setActiveTab('battle')}
          >
            Battle
          </button>
          <button
            type="button"
            className={`btn ${activeTab === 'campaign' ? 'btn-primary' : 'btn-ghost'}`}
            data-testid="tab-campaign"
            onClick={() => setActiveTab('campaign')}
          >
            Chapter Forge
          </button>
          <button
            type="button"
            className={`btn ${activeTab === 'providers' ? 'btn-primary' : 'btn-ghost'}`}
            data-testid="tab-providers"
            onClick={() => setActiveTab('providers')}
          >
            Providers &amp; Models
          </button>
          <button type="button" className={`btn ${activeTab === 'settings' ? 'btn-primary' : 'btn-ghost'}`} data-testid="tab-settings" onClick={() => setActiveTab('settings')}>Settings</button>
        </nav>

        {activeTab === 'battle' && (
          <div className="status-group">
            <span className="pill" data-testid="turn-indicator">
              Turn {visualState.turn} / {visualState.maxTurns}
            </span>
            <span className={`pill phase-${visualState.phase}`} data-testid="phase-indicator">
              {visualState.phase === 'player' ? 'Player' : 'Enemy'} Phase
            </span>
          </div>
        )}

        {activeTab === 'battle' && (
          <div className="top-actions">
            <button
              className="btn btn-primary"
              data-testid="end-phase-btn"
              disabled={!player}
              onClick={() => void send({ type: 'END_PHASE' })}
            >
              End Phase
            </button>
            {state.status === 'ongoing' && rewindButton}
            <button
              className="btn"
              data-testid="save-btn"
              disabled={busy || playback?.active}
              onClick={() => void operation(() => window.chronicleApi.save(), 'Saved to SQLite.')}
            >
              Save
            </button>
            <button
              className="btn"
              data-testid="load-btn"
              disabled={busy || !snapshot.hasSave}
              onClick={() => void operation(() => window.chronicleApi.load(), 'Loaded checkpoint.')}
            >
              Load
            </button>
            <button
              className="btn btn-danger"
              data-testid="concede-btn"
              disabled={busy || state.status !== 'ongoing'}
              onClick={() => void send({ type: 'CONCEDE' })}
            >
              Concede
            </button>
          </div>
        )}
      </header>

      {(error ?? snapshot.lastError) && (
        <div className="error-banner" role="alert">
          <span>{error ?? snapshot.lastError}</span>
          <button className="btn btn-compact" onClick={() => void send({ type: 'TECHNICAL_ABORT' })}>
            Technical abort
          </button>
        </div>
      )}
      {notice && (
        <div className="notice-banner" role="status" data-testid="notice">
          {notice}
        </div>
      )}

      {activeTab === 'menu' && (
        <main className="main-menu" data-testid="main-menu">
          <div className="menu-copy"><span className="eyebrow">THE BRASS ATLAS · VOLUME I</span>
            <h1>Every world.<br/>Your <em>chronicle.</em></h1>
            <p>Raise a company in a world of your making. Read the field, take your chances, and leave a history worth remembering.</p>
            <div className="menu-buttons">
              <button className="btn btn-primary btn-large" data-testid="open-campaigns-btn" onClick={() => setActiveTab('story')}>Begin a living campaign <span>→</span></button>
              <button className="btn btn-large" data-testid="continue-battle-btn" onClick={() => setActiveTab('battle')}>Enter the Brass Ward</button>
              <button className="btn btn-large" onClick={() => setActiveTab('campaign')}>Forge a single chapter</button>
            </div>
            <div className="menu-note"><span>A NARRATOR · HELPERS THAT WRITE THE GAME AS YOU PLAY</span><p>Any world, any rules, any number of companions.<br/>Every decision leaves its mark.</p></div>
          </div>
          <div className="menu-plate"><AtlasArt/><span className="plate-caption">PLATE I — THE COMPANY AT THE CROSSING</span></div>
        </main>
      )}
      {activeTab === 'settings' && (
        <main className="settings-screen panel" data-testid="settings-panel">
          <span className="eyebrow">MAKE YOURSELF AT HOME</span><h2>At your pace</h2>
          <p className="muted-copy">Presentation preferences are saved on this device.</p>
          <label className="field-label" htmlFor="motion-setting">Motion</label>
          <select id="motion-setting" data-testid="motion-setting" value={motionPreference} onChange={e => setMotionPreference(e.target.value as MotionPreference)}>
            <option value="system">Follow system preference</option><option value="full">Full motion</option><option value="reduced">Reduced motion</option>
          </select>
          <p className="muted-copy">Reduced motion removes travel, recoil, drifting particles and fading. Damage, status and enemy action summaries remain readable.</p>
          <label className="field-label"><input type="checkbox" checked={largeText} onChange={e => setLargeText(e.target.checked)}/> Larger interface text</label>
          <div className="settings-rule"/><h3>Sound</h3>
          <p className="muted-copy">All sound is synthesized live — no recordings. Music follows the scene: calm in conversation, tense in battle, urgent when your side is in danger.</p>
          <div className="audio-settings" data-testid="audio-settings">
            {(['master', 'music', 'effects'] as const).map((k) => (
              <label key={k} className="audio-slider">{k === 'master' ? 'Master' : k === 'music' ? 'Music' : 'Effects'}
                <input type="range" min={0} max={100} step={5} data-testid={`audio-${k}`} value={Math.round(sound[k] * 100)} onChange={(e) => setSound((s) => ({ ...s, [k]: Number(e.target.value) / 100 }))} />
                <span>{Math.round(sound[k] * 100)}%</span></label>
            ))}
            <label className="field-label"><input type="checkbox" data-testid="audio-mute" checked={sound.muted} onChange={(e) => setSound((s) => ({ ...s, muted: e.target.checked }))} /> Mute all sound</label>
            <label className="field-label" htmlFor="audio-calm">Calm audio (no percussion, softer impacts)</label>
            <select id="audio-calm" data-testid="audio-calm" value={sound.calm} onChange={(e) => setSound((s) => ({ ...s, calm: e.target.value as SoundSettings['calm'] }))}>
              <option value="system">Follow the motion preference</option><option value="on">On</option><option value="off">Off</option>
            </select>
          </div>
          <div className="settings-rule"/><h3>Reading the field</h3>
          <p>Allies carry shields; enemies carry diamonds. A check marks a spent action. Weapon marks identify sword, lance, axe, bow and tome.</p>
          <p>Arrow keys / WASD: inspect · Enter / Space: act · Escape: deselect. Tab moves between controls.</p>
          <button className="btn btn-primary" onClick={() => setActiveTab('battle')}>Return to the field</button>
        </main>
      )}
      {activeTab === 'campaign' && (
        <CampaignScreen
          onChapterLaunched={(launchedSnap) => {
            lastReplayedOrdinalRef.current = -1;
            skipEnemyPlayback();
            accept(launchedSnap);
            setActiveTab('battle');
            setNotice(`Launched chapter: ${launchedSnap.state.chapterTitle ?? 'Custom Chapter'}`);
          }}
        />
      )}

      {activeTab === 'providers' && <ProvidersScreen />}
      {activeTab === 'story' && <StoryScreen reducedMotion={reducedMotion} onView={setWorldView} />}

      {activeTab === 'battle' && (
        <main className="battle-layout">
          <section className="board-section">
            <div className="field-heading"><div><span className="eyebrow">FIELD ATLAS / {String(visualState.turn).padStart(2, '0')}</span><h2>{state.chapterTitle ?? 'The Brass Ward'}</h2></div><span className={`phase-ribbon phase-${visualState.phase}`} key={`${visualState.turn}/${visualState.phase}`} role="status">{visualState.phase === 'player' ? '◇ Your company' : '◆ Enemy advances'}</span></div>
            <div className="board-toolbar">
              <button
                type="button"
                className={`btn btn-compact ${showDangerZone ? 'btn-danger' : 'btn-ghost'}`}
                data-testid="danger-zone-btn"
                onClick={() => setShowDangerZone((v) => !v)}
              >
                {showDangerZone ? 'Danger Zone: On' : 'Danger Zone: Off'}
              </button>
              <label className="speed-control">
                Enemy speed
                <select
                  data-testid="enemy-speed-select"
                  value={enemySpeed}
                  onChange={(e) => setEnemySpeed(e.target.value as EnemySpeed)}
                >
                  <option value="slow">Slow</option>
                  <option value="normal">Normal</option>
                  <option value="fast">Fast</option>
                </select>
              </label>
              <span className="legend-hash" data-testid="state-hash">
                {snapshot.stateHash}
              </span>
            </div>

            {showEnemyBanner && (
              <div className="enemy-playback-bar" data-testid="enemy-phase-playback">
                <div className="enemy-playback-text">
                  <strong>
                    Enemy Phase
                    {playback?.active ? ` (${playback.stepIndex + 1}/${playback.steps.length})` : ''}
                  </strong>
                  <span data-testid="enemy-phase-step" role="status" aria-live="polite">
                    {currentEnemyStep ? currentEnemyStep.summary : 'Enemy forces advancing…'}
                  </span>
                </div>
                {playback?.active && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-compact"
                    data-testid="skip-enemy-phase-btn"
                    onClick={skipEnemyPlayback}
                  >
                    Skip
                  </button>
                )}
              </div>
            )}

            <PixiBoard
              snapshot={displaySnapshot}
              reducedMotion={reducedMotion}
              replayActive={!!playback?.active}
              motionSpeed={playback?.active ? { slow: 1, normal: 0.65, fast: 0.2 }[enemySpeed] : 1}
              cursor={hover ?? cursor}
              threatTiles={threatTiles}
              activeMovePath={playback?.active ? playback.activeMovePath : []}
              activeUnitId={playback?.active ? playback.activeUnitId : null}
              floatingBadges={floatingBadges}
              onTileClick={clickTile}
              onTileHover={setHover}
            />

            <div className="board-legend">
              <span className="legend-item">
                <span className="swatch swatch-move" /> Move
              </span>
              <span className="legend-item">
                <span className="swatch swatch-attack" /> Strike corners / Danger hatching
              </span>
              <span className="legend-item">
                <span className="swatch swatch-select" /> Selected / Seize
              </span>
              <span>♧ Cover: 2 MOV, +2 DEF, +20 avoid · ▧ Walls: impassable, block sight</span>
            </div>
          </section>

          <aside className="sidebar">
            {inspectedUnit && (
              <section className="panel" data-testid="actions-panel">
                <div className="inspection-heading"><Portrait unit={inspectedUnit}/><div className="inspection-title"><span className="eyebrow">{inspectedUnit.faction === 'player' ? '◇ COMPANY' : '◆ OPPOSITION'} · {inspectedUnit.hasActed ? '✓ SPENT' : 'READY'}</span>
                <div className="panel-header-row">
                  <h2>
                    {inspectedUnit.name} · {inspectedUnit.title}
                  </h2>
                  <span className="unit-badge">
                    {inspectedUnit.hp}/{inspectedUnit.maxHp} HP
                  </span>
                </div>
                </div></div>
                <div className="unit-stats">
                  <span>{inspectedUnit.weapon.name ?? inspectedUnit.weapon.tag}</span>
                  <span>MOV {inspectedUnit.mov}</span>
                  <span>
                    RNG {inspectedUnit.weapon.minRange}–{inspectedUnit.weapon.maxRange}
                  </span>
                  <span>DEF {inspectedUnit.def} / RES {inspectedUnit.res}</span>
                  <span>{inspectedUnit.actionCredits} act</span>
                </div>

                {selected && selected.id === inspectedUnit.id && (
                  <>
                    <div className="selected-actions">
                      <button
                        className="btn btn-primary btn-compact"
                        data-testid="attack-btn"
                        disabled={!player || selected.actionCredits < 1 || snapshot.attackableTargetIds.length === 0}
                        onClick={() => setAttackMode((v) => !v)}
                      >
                        {attackMode ? 'Targeting…' : 'Strike Target'}
                      </button>
                      <button
                        className="btn btn-compact"
                        data-testid="wait-btn"
                        disabled={!player || selected.actionCredits < 1}
                        onClick={() => void send({ type: 'WAIT_UNIT', unitId: selected.id })}
                      >
                        Wait
                      </button>
                      <button
                        className="btn btn-ghost btn-compact"
                        data-testid="deselect-btn"
                        disabled={!player}
                        onClick={() => void send({ type: 'SELECT_UNIT', unitId: null })}
                      >
                        Deselect
                      </button>
                      {selected.abilities.map((id) => {
                        const def = pack[id];
                        return (
                          <button
                            key={id}
                            className="btn btn-secondary btn-compact"
                            data-testid="ability-btn"
                            title={abilityTooltip(id, pack)}
                            disabled={
                              !player ||
                              !def ||
                              selected.hp < def.costs.hp ||
                              selected.actionCredits < def.costs.actions ||
                              (selected.phaseUses[def.useKey] ?? 0) >= def.usesPerPhase
                            }
                            onClick={() => void send({ type: 'USE_ABILITY', unitId: selected.id, abilityId: id })}
                          >
                            {def?.name ?? id}
                          </button>
                        );
                      })}
                    </div>
                    {selected.abilities.map((id) => (
                      <details key={id} className="ability-text">
                        <summary>Ability rules ({pack[id]?.name ?? id})</summary>
                        {abilityTooltip(id, pack)}
                      </details>
                    ))}
                    {(attackMode || snapshot.attackableTargetIds.length > 0) && (
                      <p className="muted-copy" data-testid="target-prompt">
                        Hover a highlighted enemy for forecast; click it to strike immediately.
                      </p>
                    )}
                  </>
                )}
              </section>
            )}

            {forecast && (
              <section className="panel forecast-panel" data-testid="forecast-card">
                <h2>
                  Tactical Forecast ·{' '}
                  {state.units.find((u) => u.id === forecast.attackerId)?.name} →{' '}
                  {state.units.find((u) => u.id === forecast.targetId)?.name}
                </h2>
                <p className="muted-copy">
                  {forecast.cost}. Click target to resolve immediately (Turnwheel undoes).
                </p>
                <div className="forecast-numbers">{(() => {
                  const a = state.units.find(u => u.id === forecast.attackerId)!;
                  const b = state.units.find(u => u.id === forecast.targetId)!;
                  const n = combatNumbers(state, a, b);
                  return <><span><strong>{n.baseDamage}</strong> damage / hit</span><span><strong>{n.hitBP / 100}%</strong> hit</span><span><strong>{n.critBP / 100}%</strong> crit</span></>;
                })()}</div>
                {forecast.liabilities.map((text, i) => (
                  <p key={i} className="ability-text">
                    {text}
                  </p>
                ))}
                <div className="forecast-branches">
                  {forecast.branches.map((branch, i) => (
                    <details key={i} open={forecast.branches.length <= 2} data-testid="forecast-branch">
                      <summary>{branch.label}</summary>
                      {branch.strikes.map((t, j) => (
                        <p key={j}>
                          {state.units.find((u) => u.id === t.actorId)?.name}: {t.role} {t.outcome} · hit{' '}
                          {t.hitBP / 100}% / crit {t.critBP / 100}% · HP {t.hpBefore}→{t.hpAfter}
                        </p>
                      ))}
                      <p>
                        {[forecast.attackerId, forecast.targetId]
                          .map(
                            (id) =>
                              `${state.units.find((u) => u.id === id)?.name}: ${
                                state.units.find((u) => u.id === id)?.hp
                              }→${branch.hp[id]} HP`,
                          )
                          .join(' · ')}
                      </p>
                      <p>Triggers: {branch.triggers.join('; ') || 'none'}</p>
                    </details>
                  ))}
                </div>
              </section>
            )}

            <section className="panel units-panel">
              <h2>Company &amp; opposition</h2>
              {visualState.units.map((u) => (
                <div
                  key={u.id}
                  className={`unit-card faction-${u.faction} ${
                    visualState.selectedUnitId === u.id ? 'is-selected' : ''
                  } ${u.alive ? '' : 'is-down'}`}
                  data-testid={`unit-card-${u.id}`}
                >
                  <div className="unit-header">
                    <strong>{u.faction === 'player' ? '◇' : '◆'} {u.name} {u.hasActed ? '✓' : ''}</strong>
                    <span className="unit-title">
                      {u.title} · {u.weapon.tag}
                    </span>
                  </div>
                  <div className="unit-hp-row">
                    <span>
                      HP {u.hp}/{u.maxHp}
                    </span>
                    <span>
                      Pos ({u.pos.x}, {u.pos.y})
                    </span>
                  </div>
                  <div className="hp-track">
                    <div className="hp-fill" style={{ width: `${(u.hp * 100) / u.maxHp}%` }} />
                  </div>
                  {u.statuses.map((st) => (
                    <div key={st.id} className="status-chip">
                      {pack[st.definitionId]?.name ?? st.definitionId} ×{st.stacks} · expires phase {st.expiry}
                    </div>
                  ))}
                </div>
              ))}
            </section>

            <section className="panel log-panel">
              <h2>Chronicle Log</h2>
              <ul className="event-log" data-testid="event-log">
                {[...visualState.events].reverse().map((e) => (
                  <li key={e.id} className={`log-item log-${e.kind}`}>
                    <span className="log-turn">T{e.turn}</span>
                    {e.message}
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </main>
      )}

      {activeTab === 'battle' && state.status !== 'ongoing' && !playback?.active && (
        <div
          className="end-overlay"
          role="dialog"
          aria-modal="true"
          data-testid="end-screen"
          data-outcome={state.status}
          data-reason={state.endReason}
        >
          <div className={`end-modal outcome-${state.status}`}>
            <div className="ending-seal" aria-hidden="true"><svg viewBox="0 0 40 40" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.8">{state.status === 'victory' ? <path d="M20 2L25 15L38 20L25 25L20 38L15 25L2 20L15 15Z"/> : <><path d="M9 4H31M9 36H31M11 4C11 17 16 15 20 20C24 25 29 23 29 36M29 4C29 17 24 15 20 20C16 25 11 23 11 36"/><path d="M14 31L20 24L26 31Z" fill="currentColor"/></>}</svg></div>
            <span className="eyebrow">THE CHRONICLE REMEMBERS</span>
            <h2 data-testid="end-title">{state.status.toUpperCase()}</h2>
            <p className="end-reason">{state.endReason?.replaceAll('_', ' ')}</p>
            <p className="epitaph">{state.status === 'victory' ? 'The field falls silent. Your company carries the day, and the atlas gains another page.' : 'Here ends this passage of the company. The field keeps the record; the chronicle keeps their names.'}</p>
            <div className="ending-record">Turn {state.turn} · {state.units.filter(u => u.faction === 'player' && u.alive).length} companions standing<br/>{state.units.filter(u => u.faction === 'player' && !u.alive).map(u => u.name).join(' · ') || 'No companions lost'}<p>{state.events.filter(e => e.kind === 'outcome').slice(-1)[0]?.message}</p></div>
            <div className="end-actions">
              <button
                className="btn btn-primary"
                data-testid="restart-btn"
                onClick={() => void operation(() => window.chronicleApi.restart())}
              >
                Play Again
              </button>
              {rewindButton}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
