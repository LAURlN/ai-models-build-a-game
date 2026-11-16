/**
 * Procedural audio for Chronicle Tactics. Everything is synthesized with WebAudio at
 * runtime: no recorded samples, no files, no network. Pure helpers (settings, cue
 * mapping, moods, recipes) are separated from the AudioContext so they can be tested.
 */
import type { FxCue, Loose, WorldView } from '../../engine/types';

// ---------------------------------------------------------------- settings

export interface SoundSettings { master: number; music: number; effects: number; muted: boolean; calm: 'system' | 'on' | 'off' }
export const DEFAULT_SOUND_SETTINGS: SoundSettings = { master: 0.8, music: 0.55, effects: 0.8, muted: false, calm: 'system' };
export const SOUND_SETTINGS_KEY = 'chronicle-audio';

const unit = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback);
export function normalizeSoundSettings(raw: unknown): SoundSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    master: unit(r.master, DEFAULT_SOUND_SETTINGS.master),
    music: unit(r.music, DEFAULT_SOUND_SETTINGS.music),
    effects: unit(r.effects, DEFAULT_SOUND_SETTINGS.effects),
    muted: r.muted === true,
    calm: r.calm === 'on' || r.calm === 'off' ? r.calm : 'system',
  };
}
export function loadSoundSettings(storage: Pick<Storage, 'getItem'> | null): SoundSettings {
  try { return normalizeSoundSettings(JSON.parse(storage?.getItem(SOUND_SETTINGS_KEY) ?? '{}')); } catch { return { ...DEFAULT_SOUND_SETTINGS }; }
}
export function saveSoundSettings(storage: Pick<Storage, 'setItem'> | null, settings: SoundSettings): void {
  try { storage?.setItem(SOUND_SETTINGS_KEY, JSON.stringify(normalizeSoundSettings(settings))); } catch { /* storage may be unavailable */ }
}
/** Final gains per bus. Calm mode (reduced-motion preference) softens transients and drops percussion. */
export function busGains(s: SoundSettings, reducedMotion: boolean): { music: number; effects: number; calm: boolean } {
  const calm = s.calm === 'on' || (s.calm === 'system' && reducedMotion);
  if (s.muted) return { music: 0, effects: 0, calm };
  return { music: s.master * s.music, effects: s.master * s.effects * (calm ? 0.7 : 1), calm };
}

// ---------------------------------------------------------------- recipes

export type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'notch' | 'peaking';

export interface Voice {
  wave: 'sine' | 'triangle' | 'square' | 'sawtooth' | 'noise';
  freq?: number | [number, number];
  dur: number;
  gain: number;
  delay?: number;
  attack?: number;
  release?: number;
  filter?: { type: FilterType; freq: number; q?: number };
}
export interface SoundRecipe { voices: Voice[] }

const v = (wave: Voice['wave'], freq: Voice['freq'], dur: number, gain: number, extra: Partial<Voice> = {}): Voice => ({ wave, ...(freq !== undefined ? { freq } : {}), dur, gain, ...extra });

/** Built-in cue palette: dry, woody, brass-tinged — matching the engraved-atlas look. */
export const DEFAULT_SOUNDS: Record<string, SoundRecipe> = {
  'ui.click': { voices: [v('triangle', 1250, 0.035, 0.12), v('noise', undefined, 0.02, 0.04, { filter: { type: 'highpass', freq: 4000 } })] },
  'ui.select': { voices: [v('triangle', [660, 880], 0.08, 0.16)] },
  'ui.deny': { voices: [v('square', [220, 180], 0.12, 0.08, { filter: { type: 'lowpass', freq: 1200 } })] },
  'ui.message': { voices: [v('sine', 784, 0.12, 0.12), v('sine', 1046, 0.18, 0.1, { delay: 0.08 })] },
  move: { voices: [v('noise', undefined, 0.07, 0.07, { filter: { type: 'bandpass', freq: 900, q: 2 } }), v('noise', undefined, 0.07, 0.05, { delay: 0.11, filter: { type: 'bandpass', freq: 700, q: 2 } })] },
  'attack.swing': { voices: [v('noise', undefined, 0.16, 0.12, { filter: { type: 'bandpass', freq: 1800, q: 1.2 }, attack: 0.03 })] },
  'attack.hit': { voices: [v('sine', [180, 60], 0.18, 0.4), v('noise', undefined, 0.09, 0.2, { filter: { type: 'lowpass', freq: 2400 } })] },
  'attack.miss': { voices: [v('noise', undefined, 0.22, 0.08, { filter: { type: 'highpass', freq: 2500 }, attack: 0.05 }), v('triangle', [900, 600], 0.12, 0.05, { delay: 0.04 })] },
  'attack.crit': { voices: [v('sine', [220, 50], 0.3, 0.5), v('noise', undefined, 0.16, 0.3, { filter: { type: 'lowpass', freq: 3200 } }), v('triangle', 1318, 0.35, 0.14, { delay: 0.05 }), v('triangle', 1975, 0.4, 0.1, { delay: 0.09 })] },
  defeat: { voices: [v('sine', [300, 70], 0.55, 0.3), v('noise', undefined, 0.35, 0.12, { filter: { type: 'lowpass', freq: 900 }, delay: 0.05 })] },
  ability: { voices: [v('sine', 523, 0.25, 0.14), v('sine', 784, 0.3, 0.12, { delay: 0.06 }), v('triangle', 1046, 0.4, 0.1, { delay: 0.12 })] },
  'status.buff': { voices: [v('sine', [523, 784], 0.22, 0.14), v('sine', 1046, 0.2, 0.08, { delay: 0.12 })] },
  'status.debuff': { voices: [v('triangle', [440, 330], 0.25, 0.14), v('sine', 233, 0.25, 0.08, { delay: 0.08 })] },
  heal: { voices: [v('sine', 659, 0.3, 0.12), v('sine', 880, 0.35, 0.1, { delay: 0.1 }), v('sine', 1318, 0.4, 0.06, { delay: 0.2 })] },
  'phase.player': { voices: [v('triangle', 392, 0.18, 0.14), v('triangle', 587, 0.3, 0.14, { delay: 0.12 })] },
  'phase.enemy': { voices: [v('sawtooth', 147, 0.35, 0.12, { filter: { type: 'lowpass', freq: 700 } }), v('sawtooth', 139, 0.45, 0.1, { delay: 0.15, filter: { type: 'lowpass', freq: 600 } })] },
  victory: { voices: [392, 494, 587, 784].map((f, i) => v('triangle', f, i === 3 ? 0.9 : 0.18, 0.18, { delay: i * 0.14 })).concat([v('sine', 392, 1.1, 0.12, { delay: 0.42 })]) },
  'defeat.stinger': { voices: [v('sawtooth', 220, 0.5, 0.1, { filter: { type: 'lowpass', freq: 900 } }), v('sawtooth', 207, 0.6, 0.1, { delay: 0.35, filter: { type: 'lowpass', freq: 800 } }), v('sine', 104, 1.4, 0.2, { delay: 0.7 })] },
  capture: { voices: [v('triangle', [520, 880], 0.16, 0.2), v('sine', 1175, 0.3, 0.14, { delay: 0.18 })] },
  spawn: { voices: [v('noise', undefined, 0.3, 0.08, { filter: { type: 'bandpass', freq: 500, q: 3 }, attack: 0.1 }), v('sine', [110, 220], 0.3, 0.12)] },
  'tile.change': { voices: [v('noise', undefined, 0.18, 0.08, { filter: { type: 'lowpass', freq: 600 } })] },
  'helper.done': { voices: [v('sine', 880, 0.1, 0.08), v('sine', 1318, 0.18, 0.06, { delay: 0.09 })] },
  'helper.error': { voices: [v('triangle', 330, 0.14, 0.08), v('triangle', 311, 0.2, 0.08, { delay: 0.12 })] },
};

export interface MusicTheme {
  tempo: number;
  root: number;
  scale: number[];
  progression: number[];
  layers: { pad: number; pluck: number; bass: number; drums: number; lead: number };
  pluckWave?: 'sine' | 'triangle' | 'square' | 'sawtooth';
}

export const DEFAULT_MUSIC: Record<string, MusicTheme> = {
  story: { tempo: 72, root: 50, scale: [0, 2, 4, 7, 9], progression: [0, 3, 5, 4], layers: { pad: 0.55, pluck: 0.45, bass: 0.25, drums: 0, lead: 0.25 }, pluckWave: 'triangle' },
  tense: { tempo: 84, root: 45, scale: [0, 2, 3, 5, 7, 8, 10], progression: [0, 5, 3, 4], layers: { pad: 0.6, pluck: 0.35, bass: 0.4, drums: 0.15, lead: 0.1 }, pluckWave: 'triangle' },
  battle: { tempo: 118, root: 45, scale: [0, 2, 3, 5, 7, 8, 10], progression: [0, 0, 5, 6], layers: { pad: 0.35, pluck: 0.55, bass: 0.6, drums: 0.6, lead: 0.2 }, pluckWave: 'sawtooth' },
  danger: { tempo: 132, root: 43, scale: [0, 1, 3, 5, 7, 8, 10], progression: [0, 1, 0, 6], layers: { pad: 0.45, pluck: 0.6, bass: 0.75, drums: 0.8, lead: 0.15 }, pluckWave: 'sawtooth' },
  victory: { tempo: 96, root: 55, scale: [0, 2, 4, 5, 7, 9, 11], progression: [0, 3, 4, 0], layers: { pad: 0.55, pluck: 0.5, bass: 0.35, drums: 0.2, lead: 0.4 }, pluckWave: 'triangle' },
  defeat: { tempo: 60, root: 41, scale: [0, 2, 3, 5, 7, 8, 10], progression: [0, 5, 3, 0], layers: { pad: 0.6, pluck: 0.2, bass: 0.3, drums: 0, lead: 0.15 }, pluckWave: 'sine' },
};

export function normalizeRecipe(raw: Loose): SoundRecipe | null {
  const list = Array.isArray(raw?.voices) ? raw.voices : Array.isArray(raw) ? raw : null;
  if (!list) return null;
  const voices: Voice[] = [];
  for (const item of list.slice(0, 16)) {
    if (!item || typeof item !== 'object') continue;
    const wave = ['sine', 'triangle', 'square', 'sawtooth', 'noise'].includes(item.wave) ? item.wave : 'sine';
    const num = (x: unknown, d: number, lo: number, hi: number): number => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d);
    const freq = Array.isArray(item.freq) ? [num(item.freq[0], 440, 20, 20000), num(item.freq[1], 440, 20, 20000)] as [number, number] : num(item.freq, 440, 20, 20000);
    voices.push({
      wave, freq, dur: num(item.dur, 0.2, 0.01, 8), gain: num(item.gain, 0.2, 0, 1), delay: num(item.delay, 0, 0, 8),
      attack: num(item.attack, 0.005, 0.001, 2), release: num(item.release, 0.06, 0.005, 4),
      ...(item.filter && typeof item.filter === 'object' ? { filter: { type: (['lowpass', 'highpass', 'bandpass', 'notch', 'peaking'].includes(item.filter.type) ? item.filter.type : 'lowpass') as FilterType, freq: num(item.filter.freq, 1000, 20, 20000), q: num(item.filter.q, 1, 0.0001, 40) } } : {}),
    });
  }
  return voices.length ? { voices } : null;
}

export function normalizeTheme(raw: Loose, fallback: MusicTheme): MusicTheme {
  const r = raw && typeof raw === 'object' ? raw : {};
  const num = (x: unknown, d: number, lo: number, hi: number): number => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d);
  const layers = r.layers && typeof r.layers === 'object' ? r.layers : {};
  return {
    tempo: num(r.tempo, fallback.tempo, 30, 220),
    root: num(r.root, fallback.root, 24, 84),
    scale: Array.isArray(r.scale) && r.scale.length ? r.scale.map((n: unknown) => num(n, 0, -24, 24)) : fallback.scale,
    progression: Array.isArray(r.progression) && r.progression.length ? r.progression.map((n: unknown) => Math.round(num(n, 0, -12, 12))) : fallback.progression,
    layers: {
      pad: num(layers.pad, fallback.layers.pad, 0, 1), pluck: num(layers.pluck, fallback.layers.pluck, 0, 1), bass: num(layers.bass, fallback.layers.bass, 0, 1),
      drums: num(layers.drums, fallback.layers.drums, 0, 1), lead: num(layers.lead, fallback.layers.lead, 0, 1),
    },
    pluckWave: ['sine', 'triangle', 'square', 'sawtooth'].includes(r.pluckWave) ? r.pluckWave : fallback.pluckWave ?? 'triangle',
  };
}

// ---------------------------------------------------------------- cue mapping (pure)

/** Maps an engine presentation cue to a sound id (or null). Custom `sound` cues pass through. */
export function soundForCue(cue: FxCue, playerFactions: readonly string[] = []): string | null {
  switch (cue.t) {
    case 'sound': return cue.id ?? null;
    case 'move': return cue.tone === 'forced' ? 'attack.swing' : 'move';
    case 'teleport': return 'ability';
    case 'strike': return cue.outcome === 'crit' ? 'attack.crit' : cue.outcome === 'miss' ? 'attack.miss' : 'attack.hit';
    case 'defeat': return 'defeat';
    case 'ability': return cue.tone || 'ability';
    case 'status': return cue.tone === 'buff' ? 'status.buff' : cue.tone === 'debuff' ? 'status.debuff' : null;
    case 'heal': return (cue.amount ?? 0) > 0 ? 'heal' : null;
    case 'phase': return cue.tone === 'player' || (cue.id && playerFactions.includes(cue.id)) ? 'phase.player' : 'phase.enemy';
    case 'outcome': return cue.outcome === 'victory' ? 'victory' : cue.outcome === 'retreat' ? 'phase.enemy' : 'defeat.stinger';
    case 'remove': return cue.text === 'captured' ? 'capture' : 'move';
    case 'spawn': return 'spawn';
    case 'tile': return 'tile.change';
    case 'damage': return null; // strikes already carry the impact; damage from effects is covered by 'fx'/status cues
    default: return null;
  }
}

/** Sounds for a batch of cues: de-duplicated and capped so a 90-unit enemy phase stays listenable. */
export function soundsForCues(cues: readonly FxCue[], playerFactions: readonly string[] = [], limit = 6): string[] {
  const out: string[] = [];
  const counts = new Map<string, number>();
  for (const cue of cues) {
    const id = soundForCue(cue, playerFactions);
    if (!id) continue;
    const n = counts.get(id) ?? 0;
    if (n >= 2) continue;
    counts.set(id, n + 1);
    out.push(id);
    if (out.length >= limit) break;
  }
  return out;
}

/** Adaptive music mood: battle tension rises when the player's side is in trouble. */
export function moodFor(view: Pick<WorldView, 'campaign' | 'battle'> | null): string {
  if (!view?.campaign) return 'story';
  const battle = view.battle?.state;
  if (battle) {
    if (battle.status === 'ended') return battle.outcome === 'victory' ? 'victory' : 'defeat';
    const players = new Set(Object.values(battle.factions).filter((f) => f.controller === 'player').map((f) => f.id));
    const mine = battle.units.filter((u) => players.has(u.faction));
    const hp = mine.reduce((n, u) => n + (u.alive ? u.hp : 0), 0), max = mine.reduce((n, u) => n + u.maxHp, 0) || 1;
    const foes = battle.units.filter((u) => u.alive && !players.has(u.faction)).length;
    return hp / max < 0.4 || foes > Math.max(8, mine.filter((u) => u.alive).length * 3) ? 'danger' : 'battle';
  }
  if (view.campaign.status === 'ended') return 'defeat';
  const mood = (view.campaign.scene.mood || 'story').toLowerCase();
  return mood === 'battle' ? 'tense' : mood;
}

export const midiToHz = (note: number): number => 440 * Math.pow(2, (note - 69) / 12);

/** Deterministic note choice for a step of the sequencer (pure, testable). */
export function sequencerStep(theme: MusicTheme, bar: number, step: number): { chordRoot: number; pluck: number | null; lead: number | null; kick: boolean; hat: boolean; bass: number | null } {
  const degree = theme.progression[bar % theme.progression.length] ?? 0;
  const scale = theme.scale.length ? theme.scale : [0];
  const noteAt = (deg: number, octave: number): number => theme.root + 12 * (octave + Math.floor(deg / scale.length)) + scale[((deg % scale.length) + scale.length) % scale.length]!;
  const hash = (Math.imul(bar * 31 + step + 7, 2654435761) >>> 0) / 4294967296;
  const arpeggio = [0, 2, 4, 2, 0, 4, 2, 4];
  return {
    chordRoot: noteAt(degree, 0),
    pluck: theme.layers.pluck > 0 && (step % 2 === 0 || hash > 0.6) ? noteAt(degree + arpeggio[step % 8]!, 1) : null,
    lead: theme.layers.lead > 0 && step % 4 === 0 && hash > 0.45 ? noteAt(degree + Math.floor(hash * 7), 2) : null,
    kick: theme.layers.drums > 0 && (step % 4 === 0 || (theme.tempo > 110 && step % 8 === 6)),
    hat: theme.layers.drums > 0 && step % 2 === 1,
    bass: theme.layers.bass > 0 && (step % 4 === 0 || (theme.tempo > 110 && step % 4 === 2)) ? noteAt(degree, -1) : null,
  };
}
