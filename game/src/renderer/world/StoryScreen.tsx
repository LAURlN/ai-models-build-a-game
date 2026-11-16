import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActivityTask, BattleState, CampaignSummary, DirectorStatus, Loose, WorldView } from '../../engine/types';
import { audio } from '../audio/audioEngine';
import { AtlasArt } from '../components/AtlasArt';
import { syncViewRuntime, viewRuntime, type ViewRuntime } from './moduleRuntime';
import { bodySvg } from './sprites';
import { ExtensionView, type PanelEnv } from './ui';
import { WorldBattle } from './WorldBattle';

export const EXAMPLE_SETTINGS = [
  { label: 'Creature-catching adventure', text: 'A Pokémon-style adventure across the Verdant Reach: I am a rookie wrangler with one ember-furred partner, and I want to catch wild elemental creatures, keep them in a storage box and challenge rival wranglers.' },
  { label: 'System apocalypse', text: 'A system-apocalypse battle net: at 9:14 this morning a blue RPG interface appeared over the city. Monsters, levels, skills and quests are real now, and the System hosts ranked duels on its Battle Net.' },
  { label: 'Cozy farm & wolves', text: 'A cozy farm roleplay: I inherited a small valley homestead with a few plots, six sheep and a sheepdog. Days are for planting and selling at market; some nights, wolves come down from the ridge.' },
];

const timeAgo = (t: number): string => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
};

function Lobby({ onOpen }: { onOpen: (view: WorldView) => void }) {
  const api = window.chronicleApi.world;
  const [setting, setSetting] = useState(EXAMPLE_SETTINGS[0]!.text);
  const [list, setList] = useState<CampaignSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => { void api.list().then(setList).catch((e) => setError(String(e))); }, [api]);
  useEffect(reload, [reload]);
  const run = async (fn: () => Promise<WorldView>) => {
    setBusy(true); setError(null);
    try { onOpen(await fn()); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <section className="subscreen-grid" data-testid="story-lobby">
      <div className="panel campaign-composer">
        <span className="eyebrow">A LIVING CAMPAIGN</span><h2>Describe a world. Then live in it.</h2>
        <p className="muted-copy">The Narrator runs the story with you for as long as you like. Whatever your world needs — creatures to catch, levels to earn, crops to tend, wolves at the door — helpers build it as real game code while you talk, and battles erupt whenever the story calls for them.</p>
        <div className="starter-chips">{EXAMPLE_SETTINGS.map((s, i) => <button key={i} className="btn btn-ghost btn-compact" data-testid={`example-setting-${i}`} disabled={busy} onClick={() => setSetting(s.text)}>{s.label}</button>)}</div>
        <label className="field-label" htmlFor="setting-input">Your setting</label>
        <textarea id="setting-input" data-testid="setting-input" className="premise-textarea" rows={6} value={setting} onChange={(e) => setSetting(e.target.value)} placeholder="Anything: genre, tone, who you are, what you want to do…" />
        <div className="campaign-actions">
          <button className="btn btn-primary btn-large" data-testid="begin-campaign-btn" disabled={busy || !setting.trim()} onClick={() => void run(() => api.create(setting))}>Begin the campaign</button>
        </div>
        {error && <div className="error-banner" role="alert">{error}</div>}
      </div>
      <div className="panel">
        <span className="eyebrow">YOUR CHRONICLES</span><h2>Continue a campaign</h2>
        {list.length === 0 ? <div className="empty-briefing"><AtlasArt small /><p>No campaigns yet.</p></div> : (
          <ul className="campaign-list" data-testid="campaign-list">{list.map((c) => (
            <li key={c.id} className="campaign-row">
              <div><strong>{c.title}</strong><span className="muted-copy">Turn {c.turn} · {c.battles} battle(s){c.inBattle ? ' · mid-battle' : ''} · {timeAgo(c.updatedAt)} ago{c.status === 'ended' ? ' · ended' : ''}</span></div>
              <span className="ext-actions">
                <button className="btn btn-primary btn-compact" data-testid={`continue-campaign-${c.id}`} disabled={busy} onClick={() => void run(() => api.open(c.id))}>Continue</button>
                <button className="btn btn-ghost btn-compact" disabled={busy} onClick={() => { if (window.confirm(`Delete “${c.title}” and its generated content?`)) void api.remove(c.id).then(reload); }}>Delete</button>
              </span>
            </li>))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ActivityFeed({ tasks }: { tasks: ActivityTask[] }) {
  const shown = [...tasks].reverse().slice(0, 30);
  return (
    <ul className="activity-feed" data-testid="activity-feed">
      {shown.length === 0 && <li className="muted-copy">Nothing being built right now.</li>}
      {shown.map((t) => (
        <li key={t.id} className={`activity-item status-${t.status} kind-${t.kind}`} data-testid="activity-item" data-status={t.status} data-kind={t.kind}>
          <span className="activity-dot" aria-hidden="true" />
          <div><strong>{t.title}</strong> <span className="muted-copy">{t.status}{t.model ? ` · ${t.model}` : ''}{t.finishedAt ? ` · ${Math.round((t.finishedAt - t.startedAt) / 100) / 10}s` : ''}</span>
            {t.detail && <p>{t.detail}</p>}{t.files.length > 0 && <p className="mono-small">{t.files.join(', ')}</p>}{t.error && <p className="field-warning">{t.error}</p>}</div>
        </li>))}
    </ul>
  );
}

function WorldSidebar({ view }: { view: WorldView }) {
  const c = view.campaign!;
  const entity = (label: string, items: Loose[]) => items.length > 0 && (
    <details open={items.length < 6}><summary>{label} ({items.length})</summary><ul className="world-entities">{items.map((e) => <li key={e.id}><strong>{e.name}</strong>{e.description ? ` — ${e.description}` : ''}</li>)}</ul></details>
  );
  return (
    <div className="world-sidebar" data-testid="world-sidebar">
      {c.scene.location && <p className="world-scene"><span className="eyebrow">NOW</span>{c.scene.location}{c.scene.summary ? ` — ${c.scene.summary}` : ''}</p>}
      <details open><summary>Company ({c.roster.filter((r) => r.status === 'active').length} active / {c.roster.length})</summary>
        <ul className="roster-list" data-testid="roster-list">{c.roster.map((r) => (
          <li key={r.id} className={`roster-row status-${r.status}`}>
            <span className="world-portrait" style={{ width: 34, height: 34 }} dangerouslySetInnerHTML={{ __html: bodySvg(r, 34) }} />
            <div><strong>{r.name}</strong> <span className="muted-copy">{r.title} · L{r.level} · {r.status}</span>
              <span className="muted-copy roster-detail">HP {r.hp}/{r.maxHp} · {Object.entries(r.stats).map(([k, v]) => `${k} ${v}`).join(' · ')}</span>
              {r.abilities.length > 0 && <span className="muted-copy roster-detail">{r.abilities.join(', ')}</span>}</div>
          </li>))}</ul>
      </details>
      {c.inventory.length > 0 && <details open><summary>Inventory ({c.inventory.length})</summary><ul className="inventory-list" data-testid="inventory-list">{c.inventory.map((i) => <li key={i.id} title={i.description}>{i.name} <strong>×{i.qty}</strong></li>)}</ul></details>}
      {entity('Factions', c.factions)}{entity('Relationships', c.relationships)}{entity('Places', c.places)}{entity('Threads', c.threads)}
      {c.battles.length > 0 && <details><summary>Battles ({c.battles.length})</summary><ul className="world-entities">{c.battles.map((b) => <li key={b.id}><strong>{b.title}</strong> — {b.outcome}</li>)}</ul></details>}
      {c.summary && <details><summary>Story so far</summary><p className="muted-copy">{c.summary}</p></details>}
    </div>
  );
}

export function StoryScreen({ reducedMotion, onView }: { reducedMotion: boolean; onView?: (view: WorldView | null) => void }) {
  const api = window.chronicleApi.world;
  const [view, setView] = useState<WorldView | null>(null);
  const [status, setStatus] = useState<DirectorStatus>({ busy: false, error: null, canRetry: false, tasks: [] });
  const [runtime, setRuntime] = useState<ViewRuntime>(viewRuntime());
  const [draft, setDraft] = useState('');
  const [tab, setTab] = useState('world');
  const [error, setError] = useState<string | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const revision = useRef(0);

  const accept = useCallback((next: WorldView | null) => {
    if (next && next.revision < revision.current && next.campaign?.id === view?.campaign?.id) return;
    revision.current = next?.revision ?? 0;
    setView(next);
    onView?.(next);
    void syncViewRuntime(next).then((rt) => { setRuntime({ ...rt }); audio.setCustom(rt.reg.sounds, rt.reg.music); });
  }, [onView, view?.campaign?.id]);

  useEffect(() => {
    let active = true;
    void api.view().then((v) => { if (active && v.campaign) accept(v); });
    void api.status().then((s) => { if (active) setStatus(s); });
    const offView = api.onView((v) => { if (active) accept(v); });
    let doneCount = -1;
    const offStatus = api.onStatus((s) => {
      if (!active) return;
      setStatus(s);
      const done = s.tasks.filter((t) => t.status === 'done' && t.kind !== 'narrator').length;
      if (doneCount >= 0 && done > doneCount) audio.play('helper.done');
      doneCount = done;
    });
    return () => { active = false; offView(); offStatus(); };
  }, [api]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastSeq = view?.chat.at(-1)?.seq ?? 0;
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: 'end', behavior: reducedMotion ? 'auto' : 'smooth' }); }, [lastSeq, status.busy, reducedMotion]);
  const lastNarration = useRef(0);
  useEffect(() => {
    const last = view?.chat.at(-1);
    if (last && last.role === 'narrator' && last.seq > lastNarration.current) { if (lastNarration.current) audio.play('ui.message'); lastNarration.current = last.seq; }
  }, [view?.chat]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message) return;
    setError(null);
    try { await api.say(message); setDraft(''); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const runCommand = useCallback(async (name: string, args: Loose) => {
    const result = await api.command(name, args);
    if (!result.ok) { setError(result.error); audio.play('ui.deny'); } else audio.play('ui.click');
  }, [api]);
  const panelEnv = useCallback((battle: BattleState | null, selected: string | null): PanelEnv => {
    const c = view!.campaign!;
    const campaign = battle ? { ...c, inventory: battle.world.inventory, vars: battle.world.vars } : c;
    return {
      campaign, battle, selected: battle?.units.find((u) => u.id === selected) ?? null,
      send: runCommand,
      battleSend: async (name, args) => { const r = await api.battleCommand({ type: 'custom', name, args }); if (!r.ok) { setError(r.error); audio.play('ui.deny'); } },
      sound: (id) => audio.play(id),
    };
  }, [view, runCommand, api]);

  const storyPanels = useMemo(() => runtime.reg.panels.filter((p) => p.scope === 'story' || p.scope === 'both'), [runtime]);

  if (!view?.campaign) return <Lobby onOpen={accept} />;
  const c = view.campaign;
  if (view.battle) {
    return <WorldBattle snapshot={view.battle} campaign={c} runtime={runtime} reducedMotion={reducedMotion} panelEnv={panelEnv}
      onResolve={async () => { try { await api.battleResolve(); } catch (e) { setError(String(e)); } }} />;
  }
  const running = status.tasks.filter((t) => t.status === 'running' || t.status === 'queued');
  const pending = c.pendingBattle;
  const moduleErrors = view.modules.filter((m) => m.status !== 'loaded');

  return (
    <main className="story-layout" data-testid="story-screen">
      <section className="story-main">
        <div className="story-heading">
          <div><span className="eyebrow">TURN {c.turn} · {c.battles.length} BATTLE(S) · {view.modules.length} GENERATED SYSTEM(S)</span><h2 data-testid="campaign-title">{c.title}</h2></div>
          <span className="ext-actions">
            {running.length > 0 && <button className="pill builders-pill" data-testid="builders-pill" onClick={() => setTab('activity')}>⚒ {running.length} building</button>}
            <button className="btn btn-ghost btn-compact" data-testid="leave-campaign-btn" onClick={() => void api.close().then(() => accept(null))}>All campaigns</button>
          </span>
        </div>
        {pending && pending.status !== 'ready' && (
          <div className={`battle-banner status-${pending.status}`} data-testid="pending-battle" data-status={pending.status} role="status">
            <strong>⚔ {pending.title}</strong>
            <span>{pending.status === 'failed' ? `Could not be staged: ${pending.error}` : pending.waitingOn.length ? `Preparing — waiting for: ${pending.waitingOn.join(', ')}` : 'Preparing the field…'}</span>
          </div>
        )}
        <div className="chat-log" data-testid="chat-log" aria-live="polite">
          {view.chatTotal > view.chat.length && <p className="muted-copy chat-older">{view.chatTotal - view.chat.length} earlier messages are in the archive (the Narrator still remembers them).</p>}
          {view.chat.map((m) => (
            <article key={m.seq} className={`chat-msg role-${m.role} kind-${m.kind ?? 'none'}`} data-testid={`chat-${m.role}`}>
              {m.role === 'narrator' && <span className="chat-author">Narrator</span>}
              {m.role === 'player' && <span className="chat-author">You</span>}
              {m.text.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}
            </article>
          ))}
          {status.busy && <article className="chat-msg role-narrator is-typing" data-testid="narrator-typing"><span className="chat-author">Narrator</span><p>…</p></article>}
          <div ref={chatEnd} />
        </div>
        {(status.error || error) && (
          <div className="error-banner" role="alert" data-testid="story-error"><span>{error ?? status.error}</span>
            {status.canRetry && !error && <button className="btn btn-compact" data-testid="retry-btn" onClick={() => void api.retry()}>Retry</button>}
            {error && <button className="btn btn-compact" onClick={() => setError(null)}>Dismiss</button>}</div>
        )}
        {c.status === 'ended' ? <div className="battle-banner status-failed"><strong>The chronicle has ended.</strong><span>{c.ending}</span></div> : (
          <>
            {c.suggestions.length > 0 && !status.busy && <div className="starter-chips suggestions" data-testid="suggestions">{c.suggestions.map((s, i) => <button key={i} className="btn btn-ghost btn-compact" onClick={() => void send(s)}>{s}</button>)}</div>}
            <form className="chat-input" onSubmit={(e) => { e.preventDefault(); void send(draft); }}>
              <textarea data-testid="chat-input" value={draft} rows={2} placeholder={status.busy ? 'The Narrator is writing…' : 'Say or do anything…'} onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(draft); } }} />
              <button className="btn btn-primary" data-testid="chat-send" type="submit" disabled={status.busy || !draft.trim()}>Send</button>
            </form>
          </>
        )}
      </section>
      <aside className="story-side">
        <div className="side-tabs" role="tablist">
          {[['world', 'World'], ['activity', `Activity${running.length ? ` (${running.length})` : ''}`], ['systems', `Systems${moduleErrors.length ? ' ⚠' : ''}`], ...storyPanels.map((p) => [`panel:${p.id}`, `${p.icon} ${p.title}`])].map(([id, title]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={`side-tab ${tab === id ? 'is-active' : ''}`} data-testid={`story-tab-${id}`} onClick={() => setTab(id!)}>{title}</button>
          ))}
        </div>
        <section className="panel story-side-panel">
          {tab === 'world' && <WorldSidebar view={view} />}
          {tab === 'activity' && <ActivityFeed tasks={status.tasks} />}
          {tab === 'systems' && (
            <ul className="module-list" data-testid="module-list">
              {view.modules.length === 0 && <li className="muted-copy">No generated systems yet. Ask for anything — helpers will build it.</li>}
              {view.modules.map((m) => (
                <li key={m.id} className={`module-row status-${m.status}`} data-testid={`module-${m.id}`} data-status={m.status}>
                  <strong>{m.name}</strong> <span className="pill">{m.status}</span><p className="muted-copy">{m.description}</p>
                  <p className="mono-small">{m.file} · {Object.entries(m.provides).map(([k, ids]) => `${ids.length} ${k}`).join(' · ')}</p>
                  {m.error && <p className="field-warning">{m.error.split('\n')[0]}</p>}
                </li>))}
            </ul>
          )}
          {storyPanels.map((p) => tab === `panel:${p.id}` && <ExtensionView key={p.id} moduleId={p.module} testId={`ext-panel-${p.id}`} render={p.render} env={panelEnv(null, null)} />)}
        </section>
      </aside>
    </main>
  );
}
