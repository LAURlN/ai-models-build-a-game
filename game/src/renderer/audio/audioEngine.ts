/** WebAudio synthesis engine: SFX voices and the adaptive music sequencer. */
import type { Loose } from '../../engine/types';
import {
  DEFAULT_MUSIC, DEFAULT_SOUND_SETTINGS, DEFAULT_SOUNDS, busGains, midiToHz, normalizeRecipe, normalizeTheme, sequencerStep,
  type MusicTheme, type SoundSettings, type Voice,
} from './sound';


export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private fxBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private settings: SoundSettings = { ...DEFAULT_SOUND_SETTINGS };
  private reducedMotion = false;
  private customSounds: Record<string, Loose> = {};
  private customMusic: Record<string, Loose> = {};
  private mood = 'story';
  private theme: MusicTheme = DEFAULT_MUSIC.story!;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0;
  private step = 0;
  private bar = 0;
  private moodGain: GainNode | null = null;
  private lastPlayed = new Map<string, number>();
  /** Last few sound ids actually played (exposed for tests and the debug overlay). */
  readonly history: string[] = [];

  configure(settings: SoundSettings, reducedMotion: boolean): void {
    this.settings = settings; this.reducedMotion = reducedMotion;
    this.applyGains();
  }
  setCustom(sounds: Record<string, Loose>, music: Record<string, Loose>): void { this.customSounds = sounds; this.customMusic = music; }

  /** Must be called from a user gesture the first time (autoplay policy). */
  unlock(): void {
    if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.musicBus = this.ctx.createGain();
        this.fxBus = this.ctx.createGain();
        this.musicBus.connect(this.master); this.fxBus.connect(this.master); this.master.connect(this.ctx.destination);
        const length = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        let seed = 22222;
        for (let i = 0; i < length; i++) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; data[i] = (seed / 4294967296) * 2 - 1; }
        this.applyGains();
      } catch { this.ctx = null; return; }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
    if (!this.timer) this.startMusic();
  }
  get unlocked(): boolean { return !!this.ctx; }

  private applyGains(): void {
    if (!this.ctx || !this.musicBus || !this.fxBus || !this.master) return;
    const g = busGains(this.settings, this.reducedMotion), t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.muted ? 0 : 1, t, 0.05);
    this.musicBus.gain.setTargetAtTime(g.music * 0.35, t, 0.2);
    this.fxBus.gain.setTargetAtTime(g.effects * 0.9, t, 0.05);
  }

  play(id: string): void {
    this.history.push(id); if (this.history.length > 40) this.history.shift();
    const ctx = this.ctx, bus = this.fxBus;
    if (!ctx || !bus || this.settings.muted) return;
    const now = ctx.currentTime;
    if ((this.lastPlayed.get(id) ?? -1) > now - 0.04) return; // same sound within 40 ms: merge
    this.lastPlayed.set(id, now);
    const recipe = normalizeRecipe(this.customSounds[id]) ?? DEFAULT_SOUNDS[id] ?? (id.startsWith('attack') ? DEFAULT_SOUNDS['attack.hit'] : DEFAULT_SOUNDS.ability);
    if (!recipe) return;
    const calm = busGains(this.settings, this.reducedMotion).calm;
    for (const voice of recipe.voices) this.voice(voice, now + (voice.delay ?? 0), bus, calm ? 0.75 : 1);
  }

  private voice(voice: Voice, at: number, out: AudioNode, scale = 1): void {
    const ctx = this.ctx!;
    const amp = ctx.createGain();
    const attack = voice.attack ?? 0.005, release = voice.release ?? 0.06, end = at + voice.dur;
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, voice.gain * scale), at + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, end + release);
    let source: AudioScheduledSourceNode;
    if (voice.wave === 'noise') {
      const node = ctx.createBufferSource(); node.buffer = this.noise; node.loop = true; source = node;
    } else {
      const osc = ctx.createOscillator(); osc.type = voice.wave;
      const [f0, f1] = Array.isArray(voice.freq) ? voice.freq : [voice.freq ?? 440, voice.freq ?? 440];
      osc.frequency.setValueAtTime(f0, at);
      if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), end);
      source = osc;
    }
    let chain: AudioNode = source;
    if (voice.filter) {
      const filter = ctx.createBiquadFilter(); filter.type = voice.filter.type; filter.frequency.value = voice.filter.freq; filter.Q.value = voice.filter.q ?? 1;
      chain.connect(filter); chain = filter;
    }
    chain.connect(amp); amp.connect(out);
    source.start(at); source.stop(end + release + 0.05);
    source.onended = () => { try { amp.disconnect(); } catch { /* already gone */ } };
  }

  setMood(mood: string): void {
    const next = this.customMusic[mood] ? normalizeTheme(this.customMusic[mood], DEFAULT_MUSIC[mood] ?? DEFAULT_MUSIC.story!) : DEFAULT_MUSIC[mood] ?? normalizeTheme(this.customMusic.story, DEFAULT_MUSIC.story!);
    if (mood === this.mood && JSON.stringify(next) === JSON.stringify(this.theme)) return;
    this.mood = mood;
    this.theme = next;
    // Crossfade: fade the current layer out, start a fresh one on the next bar.
    if (this.ctx && this.moodGain) {
      const old = this.moodGain, t = this.ctx.currentTime;
      old.gain.setTargetAtTime(0, t, 0.6);
      setTimeout(() => { try { old.disconnect(); } catch { /* gone */ } }, 4000);
      this.moodGain = null;
    }
    this.bar = 0; this.step = 0;
  }
  get currentMood(): string { return this.mood; }

  private startMusic(): void {
    if (!this.ctx) return;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 90);
  }
  private schedule(): void {
    const ctx = this.ctx, bus = this.musicBus;
    if (!ctx || !bus || ctx.state !== 'running') return;
    if (!this.moodGain) {
      this.moodGain = ctx.createGain(); this.moodGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      this.moodGain.gain.setTargetAtTime(1, ctx.currentTime, 0.8); this.moodGain.connect(bus);
      this.nextTime = Math.max(this.nextTime, ctx.currentTime + 0.05);
    }
    const out = this.moodGain, theme = this.theme, calm = busGains(this.settings, this.reducedMotion).calm;
    const stepDur = 60 / theme.tempo / 2; // eighth notes
    while (this.nextTime < ctx.currentTime + 0.35) {
      const s = sequencerStep(theme, this.bar, this.step), t = this.nextTime;
      if (this.step === 0 && theme.layers.pad > 0) {
        for (const offset of [0, 7, theme.scale.includes(3) ? 15 : 16]) {
          this.voice({ wave: 'triangle', freq: midiToHz(s.chordRoot + offset), dur: stepDur * 7.2, gain: 0.05 * theme.layers.pad, attack: stepDur * 2, release: stepDur * 2, filter: { type: 'lowpass', freq: 1400 } }, t, out);
        }
      }
      if (s.bass !== null) this.voice({ wave: 'sine', freq: midiToHz(s.bass), dur: stepDur * 1.6, gain: 0.16 * theme.layers.bass, attack: 0.01, release: 0.08 }, t, out);
      if (s.pluck !== null) this.voice({ wave: theme.pluckWave ?? 'triangle', freq: midiToHz(s.pluck), dur: stepDur * 0.7, gain: 0.05 * theme.layers.pluck, attack: 0.004, release: 0.12, filter: { type: 'lowpass', freq: 2600 } }, t, out);
      if (s.lead !== null) this.voice({ wave: 'sine', freq: midiToHz(s.lead), dur: stepDur * 3, gain: 0.04 * theme.layers.lead, attack: 0.05, release: 0.3 }, t, out);
      if (!calm && s.kick) this.voice({ wave: 'sine', freq: [130, 45], dur: 0.16, gain: 0.22 * theme.layers.drums, attack: 0.002, release: 0.05 }, t, out);
      if (!calm && s.hat) this.voice({ wave: 'noise', dur: 0.03, gain: 0.03 * theme.layers.drums, attack: 0.001, release: 0.02, filter: { type: 'highpass', freq: 7000 } }, t, out);
      this.nextTime += stepDur;
      if (++this.step >= 8) { this.step = 0; this.bar++; }
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}

export const audio = new AudioEngine();
