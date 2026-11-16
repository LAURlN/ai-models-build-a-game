import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBattle } from '../src/engine/battle';
import { createRegistry } from '../src/engine/registry';
import type { FxCue, WorldView } from '../src/engine/types';
import {
  DEFAULT_MUSIC, DEFAULT_SOUND_SETTINGS, DEFAULT_SOUNDS, SOUND_SETTINGS_KEY, busGains, loadSoundSettings, moodFor, normalizeRecipe,
  normalizeSoundSettings, normalizeTheme, saveSoundSettings, sequencerStep, soundForCue, soundsForCues,
} from '../src/renderer/audio/sound';

class MemoryStorage { data = new Map<string, string>(); getItem(k: string) { return this.data.get(k) ?? null; } setItem(k: string, v: string) { this.data.set(k, v); } }

describe('sound settings', () => {
  it('persists master/music/effects/mute/calm and clamps garbage', () => {
    const storage = new MemoryStorage();
    expect(loadSoundSettings(storage)).toEqual(DEFAULT_SOUND_SETTINGS);
    saveSoundSettings(storage, { master: 0.5, music: 2, effects: -1, muted: true, calm: 'on' });
    expect(JSON.parse(storage.getItem(SOUND_SETTINGS_KEY)!)).toEqual({ master: 0.5, music: 1, effects: 0, muted: true, calm: 'on' });
    expect(loadSoundSettings(storage)).toEqual({ master: 0.5, music: 1, effects: 0, muted: true, calm: 'on' });
    storage.setItem(SOUND_SETTINGS_KEY, '{not json');
    expect(loadSoundSettings(storage)).toEqual(DEFAULT_SOUND_SETTINGS);
    expect(normalizeSoundSettings({ calm: 'loud' }).calm).toBe('system');
  });
  it('mute silences both buses; calm follows the reduced-motion preference unless overridden', () => {
    const s = { ...DEFAULT_SOUND_SETTINGS, master: 0.5, music: 0.8, effects: 1 };
    expect(busGains(s, false)).toEqual({ music: 0.4, effects: 0.5, calm: false });
    expect(busGains(s, true)).toMatchObject({ calm: true, effects: 0.35 });
    expect(busGains({ ...s, calm: 'off' }, true).calm).toBe(false);
    expect(busGains({ ...s, calm: 'on' }, false).calm).toBe(true);
    expect(busGains({ ...s, muted: true }, false)).toMatchObject({ music: 0, effects: 0 });
  });
});

describe('cue mapping', () => {
  it('maps every engine cue to a synthesized sound', () => {
    const cases: [FxCue, string | null][] = [
      [{ t: 'move' }, 'move'], [{ t: 'move', tone: 'forced' }, 'attack.swing'], [{ t: 'strike', outcome: 'hit' }, 'attack.hit'],
      [{ t: 'strike', outcome: 'miss' }, 'attack.miss'], [{ t: 'strike', outcome: 'crit' }, 'attack.crit'], [{ t: 'defeat' }, 'defeat'],
      [{ t: 'ability' }, 'ability'], [{ t: 'ability', tone: 'capture-throw' }, 'capture-throw'], [{ t: 'status', tone: 'buff' }, 'status.buff'],
      [{ t: 'status', tone: 'debuff' }, 'status.debuff'], [{ t: 'heal', amount: 3 }, 'heal'], [{ t: 'heal', amount: 0 }, null],
      [{ t: 'phase', tone: 'player' }, 'phase.player'], [{ t: 'phase', tone: 'ai' }, 'phase.enemy'], [{ t: 'outcome', outcome: 'victory' }, 'victory'],
      [{ t: 'outcome', outcome: 'defeat' }, 'defeat.stinger'], [{ t: 'remove', text: 'captured' }, 'capture'], [{ t: 'sound', id: 'level-up' }, 'level-up'],
      [{ t: 'spawn' }, 'spawn'], [{ t: 'float' }, null],
    ];
    for (const [cue, id] of cases) expect(soundForCue(cue), JSON.stringify(cue)).toBe(id);
    for (const [, id] of cases) if (id && !['capture-throw', 'level-up'].includes(id)) expect(DEFAULT_SOUNDS[id], id).toBeTruthy();
  });
  it('caps a huge enemy phase to a listenable set', () => {
    const cues: FxCue[] = Array.from({ length: 90 }, (_, i) => ({ t: 'strike', outcome: i % 3 ? 'hit' : 'miss' }));
    expect(soundsForCues(cues)).toEqual(['attack.miss', 'attack.hit', 'attack.hit', 'attack.miss']);
    expect(soundsForCues([...cues, { t: 'outcome', outcome: 'victory' }], [], 6)).toContain('victory');
  });
  it('documents every built-in cue id in the extension API', () => {
    const doc = readFileSync(path.resolve(__dirname, '../src/content/EXTENSION_API.md'), 'utf8');
    for (const id of ['ui.click', 'move', 'attack.hit', 'attack.miss', 'attack.crit', 'defeat', 'ability', 'status.buff', 'status.debuff', 'heal', 'phase.player', 'phase.enemy', 'victory', 'defeat.stinger', 'capture']) {
      expect(doc).toContain(id); expect(DEFAULT_SOUNDS[id]).toBeTruthy();
    }
  });
});

describe('adaptive music', () => {
  const reg = createRegistry();
  const battle = (hp: number) => {
    const state = createBattle({ map: { width: 8, height: 6 }, units: [{ name: 'A', faction: 'player', maxHp: 20, hp }, { name: 'B', faction: 'enemy', area: 'east' }] }, reg, { roster: [], inventory: [], vars: {} });
    return { state, hash: '', rewindsLeft: 3, canRewind: false, revision: 1 };
  };
  const view = (patch: Partial<WorldView>): WorldView => ({ revision: 1, campaign: { scene: { mood: 'story' }, status: 'active' } as never, chat: [], chatTotal: 0, modules: [], moduleFiles: [], battle: null, workspace: '', ...patch });
  it('follows the scene in roleplay and escalates in battle', () => {
    expect(moodFor(null)).toBe('story');
    expect(moodFor(view({}))).toBe('story');
    expect(moodFor(view({ campaign: { scene: { mood: 'tense' }, status: 'active' } as never }))).toBe('tense');
    expect(moodFor(view({ battle: battle(20) }))).toBe('battle');
    expect(moodFor(view({ battle: battle(4) }))).toBe('danger');
    const won = battle(20); won.state.status = 'ended'; won.state.outcome = 'victory';
    expect(moodFor(view({ battle: won }))).toBe('victory');
  });
  it('sequences deterministic, mood-appropriate patterns; module themes and recipes are clamped', () => {
    const a = Array.from({ length: 16 }, (_, i) => sequencerStep(DEFAULT_MUSIC.battle!, Math.floor(i / 8), i % 8));
    expect(a).toEqual(Array.from({ length: 16 }, (_, i) => sequencerStep(DEFAULT_MUSIC.battle!, Math.floor(i / 8), i % 8)));
    expect(a.some((s) => s.kick)).toBe(true);
    expect(Array.from({ length: 8 }, (_, i) => sequencerStep(DEFAULT_MUSIC.story!, 0, i)).some((s) => s.kick)).toBe(false);
    expect(normalizeTheme({ tempo: 9999, scale: [], layers: { drums: 3 } }, DEFAULT_MUSIC.story!)).toMatchObject({ tempo: 220, scale: DEFAULT_MUSIC.story!.scale, layers: { drums: 1, pad: DEFAULT_MUSIC.story!.layers.pad } });
    expect(normalizeRecipe({ voices: [{ wave: 'laser', freq: [5, 99999], dur: 100, gain: 7 }] })).toEqual({ voices: [{ wave: 'sine', freq: [20, 20000], dur: 8, gain: 1, delay: 0, attack: 0.005, release: 0.06 }] });
    expect(normalizeRecipe('nope')).toBeNull();
  });
});
