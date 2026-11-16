import { useCallback, useEffect, useState } from 'react';
import type {
  FallbackModelEntry,
  GenerationRole,
  ModelEffortOption,
  ProviderInfo,
  ProviderSettings,
  RoleModelSelection,
  SidecarHealthStatus,
} from '../../shared/contracts';

const DEFAULT_EFFORTS: ModelEffortOption[] = ['', 'low', 'medium', 'high', 'xhigh'];
type SlotRole = GenerationRole | 'narrator' | 'helper';
/** Story slots fall back to the chapter slots until the player sets them explicitly. */
const slotOf = (settings: ProviderSettings, role: SlotRole): RoleModelSelection =>
  role === 'narrator' ? settings.narrator ?? settings.chronicler : role === 'helper' ? settings.helper ?? settings.architect : settings[role];

export function ProvidersScreen() {
  const [sidecar, setSidecar] = useState<SidecarHealthStatus | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [settings, setSettings] = useState<ProviderSettings | null>(null);
  const [authInputs, setAuthInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setError(null);
    const [statusRes, settingsRes] = await Promise.allSettled([
      window.chronicleApi.getSidecarStatus(),
      window.chronicleApi.getProviderSettings(),
    ]);
    if (statusRes.status === 'fulfilled') setSidecar(statusRes.value);
    if (settingsRes.status === 'fulfilled') setSettings(settingsRes.value);

    try {
      const list = await window.chronicleApi.listProviders();
      setProviders(list);
      const freshStatus = await window.chronicleApi.getSidecarStatus();
      setSidecar(freshStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    let active = true;
    void loadAll();
    const unsub = window.chronicleApi.onProvidersUpdated((list) => {
      if (active) setProviders(list);
    });
    return () => {
      active = false;
      unsub();
    };
  }, [loadAll]);

  const runAction = async (fn: () => Promise<void>, successMessage?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (successMessage) setNotice(successMessage);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const updateSlot = (role: SlotRole, patch: Partial<RoleModelSelection>) => {
    setSettings((prev) => {
      if (!prev) return prev;
      const current = slotOf(prev, role);
      let next: RoleModelSelection = { ...current, ...patch };
      if (patch.providerId && patch.providerId !== current.providerId) {
        const prov = providers.find((p) => p.instanceId === patch.providerId);
        const firstSelectable = prov?.models.find((m) => m.selectable) ?? prov?.models[0];
        if (firstSelectable) {
          next = {
            providerId: patch.providerId,
            model: firstSelectable.slug,
            effort: (firstSelectable.defaultEffort as ModelEffortOption) || 'low',
          };
        }
      }
      return { ...prev, [role]: next };
    });
  };

  const updateFallback = (index: number, patch: Partial<FallbackModelEntry>) => {
    setSettings((prev) => {
      if (!prev) return prev;
      const nextList = [...prev.fallbacks];
      const current = nextList[index]!;
      let updated: FallbackModelEntry = { ...current, ...patch };
      if (patch.providerId && patch.providerId !== current.providerId) {
        const prov = providers.find((p) => p.instanceId === patch.providerId);
        const firstSelectable = prov?.models.find((m) => m.selectable) ?? prov?.models[0];
        if (firstSelectable) {
          updated = {
            providerId: patch.providerId,
            model: firstSelectable.slug,
            effort: (firstSelectable.defaultEffort as ModelEffortOption) || 'low',
          };
        }
      }
      nextList[index] = updated;
      return { ...prev, fallbacks: nextList };
    });
  };

  const addFallback = () => {
    setSettings((prev) => {
      if (!prev) return prev;
      const preferred =
        providers.find((p) => p.authStatus === 'authenticated' && p.models.some((m) => m.selectable)) ??
        providers[0];
      const model = preferred?.models.find((m) => m.selectable) ?? preferred?.models[0];
      const entry: FallbackModelEntry = {
        providerId: preferred?.instanceId ?? prev.architect.providerId,
        model: model?.slug ?? prev.architect.model,
        effort: (model?.defaultEffort as ModelEffortOption) || 'low',
      };
      return { ...prev, fallbacks: [...prev.fallbacks, entry] };
    });
  };

  const moveFallback = (index: number, delta: -1 | 1) => {
    setSettings((prev) => {
      if (!prev) return prev;
      const target = index + delta;
      if (target < 0 || target >= prev.fallbacks.length) return prev;
      const nextList = [...prev.fallbacks];
      const [item] = nextList.splice(index, 1);
      nextList.splice(target, 0, item!);
      return { ...prev, fallbacks: nextList };
    });
  };

  const removeFallback = (index: number) => {
    setSettings((prev) => {
      if (!prev) return prev;
      return { ...prev, fallbacks: prev.fallbacks.filter((_, i) => i !== index) };
    });
  };

  const renderSlotEditor = (role: SlotRole, title: string, description: string) => {
    if (!settings) return null;
    const slot = slotOf(settings, role);
    const selectedProvider = providers.find((p) => p.instanceId === slot.providerId);
    const models = selectedProvider?.models ?? [];
    const selectedModel = models.find((m) => m.slug === slot.model);
    const efforts =
      selectedModel && selectedModel.supportedEffortLevels.length > 0
        ? (['', ...selectedModel.supportedEffortLevels] as ModelEffortOption[])
        : DEFAULT_EFFORTS;

    return (
      <div className="slot-card" data-testid={`slot-${role}`}>
        <h3>{title}</h3>
        <p className="muted-copy">{description}</p>
        <div className="slot-controls">
          <label>
            Provider
            <select
              data-testid={`${role}-provider-select`}
              value={slot.providerId}
              onChange={(e) => updateSlot(role, { providerId: e.target.value })}
            >
              {providers.length === 0 && <option value={slot.providerId}>{slot.providerId}</option>}
              {providers.map((p) => (
                <option key={p.instanceId} value={p.instanceId}>
                  {p.name} ({p.authStatus === 'authenticated' ? 'Ready' : p.authLabel})
                </option>
              ))}
            </select>
          </label>

          <label>
            Model
            <select
              data-testid={`${role}-model-select`}
              value={slot.model}
              onChange={(e) => updateSlot(role, { model: e.target.value })}
            >
              {!models.some((m) => m.slug === slot.model) && (
                <option value={slot.model}>{slot.model} (saved)</option>
              )}
              {models.map((m) => (
                <option key={m.slug} value={m.slug} disabled={!m.selectable}>
                  {m.name}
                  {m.disabledReason ? ` — ${m.disabledReason}` : ''}
                </option>
              ))}
            </select>
          </label>

          <label>
            Effort
            <select
              data-testid={`${role}-effort-select`}
              value={slot.effort ?? ''}
              onChange={(e) => updateSlot(role, { effort: e.target.value as ModelEffortOption })}
            >
              {efforts.map((ef) => (
                <option key={ef || 'default'} value={ef}>
                  {ef || 'Default'}
                </option>
              ))}
            </select>
          </label>
        </div>
        {selectedModel?.disabledReason && (
          <p className="field-warning" data-testid={`${role}-disabled-reason`}>
            Disabled reason: {selectedModel.disabledReason}
          </p>
        )}
      </div>
    );
  };

  return (
    <section className="subscreen-grid" data-testid="providers-panel">
      <div className="panel">
        <div className="panel-header-row">
          <div><span className="eyebrow">THE VOICES BEHIND YOUR WORLD</span><h2>Providers &amp; Models</h2></div>
          <button
            type="button"
            className="btn btn-secondary"
            data-testid="refresh-providers-btn"
            disabled={busy}
            onClick={() =>
              void runAction(async () => {
                const list = await window.chronicleApi.refreshProviders();
                setProviders(list);
                setSidecar(await window.chronicleApi.getSidecarStatus());
              }, 'Refreshed provider status.')
            }
          >
            Re-check
          </button>
        </div>

        <div className="sidecar-banner" data-testid="sidecar-status">
          <span>
            <strong>Generation service:</strong> {sidecar?.connected ? 'Connected' : 'Disconnected'}
            {sidecar?.fakeMode ? ' · Fake Test Mode' : ''}
          </span>
          {sidecar?.baseDir && <details><summary>Connection details</summary><span className="mono-small">PID {sidecar.pid} · Isolated dir: {sidecar.baseDir}</span></details>}
          {sidecar?.lastError && <span className="field-warning">{sidecar.lastError}</span>}
        </div>

        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="notice-banner" role="status" data-testid="settings-saved-notice">
            {notice}
          </div>
        )}

        <div className="provider-list">
          {providers.length === 0 ? (
            <p className="muted-copy">
              No providers reported by embedded sidecar. Campaign generation will use Local Fallback.
            </p>
          ) : (
            providers.map((p) => (
              <div key={p.instanceId} className="provider-card" data-testid={`provider-card-${p.instanceId}`}>
                <div className="provider-card-top">
                  <div>
                    <strong>{p.name}</strong>{' '}
                    <span className="muted-copy">({p.driverKind})</span>
                    <div className="muted-copy">
                      {p.authLabel}
                      {p.accountEmail ? ` · ${p.accountEmail}` : ''}
                    </div>
                  </div>
                  <span
                    className={`pill ${
                      p.authStatus === 'authenticated'
                        ? 'badge-generated'
                        : p.installed
                          ? 'badge-repaired'
                          : 'badge-fallback'
                    }`}
                  >
                    {p.authStatus === 'authenticated'
                      ? 'Connected'
                      : p.installed
                        ? 'Not connected'
                        : 'Not installed'}
                  </span>
                </div>

                {p.message && <p className="muted-copy">{p.message}</p>}

                <div className="provider-actions">
                  {p.authStatus !== 'authenticated' ? (
                    p.authMethods.map((method) => (
                      <button
                        key={method.methodId}
                        type="button"
                        className="btn btn-primary btn-compact"
                        data-testid={`connect-provider-${p.instanceId}`}
                        disabled={busy || !method.available}
                        title={method.reason}
                        onClick={() =>
                          void runAction(async () => {
                            await window.chronicleApi.startProviderAuth(p.instanceId, method.methodId);
                            const list = await window.chronicleApi.listProviders();
                            setProviders(list);
                          }, `Started auth flow for ${p.name}.`)
                        }
                      >
                        {method.label || 'Connect'}
                      </button>
                    ))
                  ) : (
                    <button
                      type="button"
                      className="btn btn-danger btn-compact"
                      data-testid={`disconnect-provider-${p.instanceId}`}
                      disabled={busy}
                      onClick={() =>
                        void runAction(async () => {
                          await window.chronicleApi.logoutProvider(p.instanceId);
                          const list = await window.chronicleApi.listProviders();
                          setProviders(list);
                        }, `Disconnected ${p.name}.`)
                      }
                    >
                      Disconnect
                    </button>
                  )}
                </div>

                {p.activeFlow && (
                  <div className="auth-flow-box" data-testid={`auth-flow-${p.instanceId}`}>
                    <div>
                      <strong>Auth Flow ({p.activeFlow.phase}):</strong>{' '}
                      {p.activeFlow.message ?? 'Follow instructions to connect.'}
                    </div>
                    {p.activeFlow.url && (
                      <div className="mono-small">Auth URL: {p.activeFlow.url}</div>
                    )}
                    {p.activeFlow.userCode && (
                      <div className="mono-small">Device code: {p.activeFlow.userCode}</div>
                    )}
                    <div className="auth-flow-controls">
                      <input
                        type="text"
                        placeholder="Optional code / label"
                        value={authInputs[p.instanceId] ?? ''}
                        onChange={(e) =>
                          setAuthInputs((prev) => ({ ...prev, [p.instanceId]: e.target.value }))
                        }
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-compact"
                        disabled={busy}
                        onClick={() =>
                          void runAction(async () => {
                            const text = (authInputs[p.instanceId] ?? '').trim();
                            await window.chronicleApi.respondProviderAuth(
                              p.instanceId,
                              p.activeFlow!.flowId,
                              text
                                ? { type: 'code', code: text }
                                : { type: 'browser', action: 'complete' },
                            );
                            const list = await window.chronicleApi.listProviders();
                            setProviders(list);
                          })
                        }
                      >
                        Submit
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-compact"
                        disabled={busy}
                        onClick={() =>
                          void runAction(async () => {
                            await window.chronicleApi.completeProviderAuth(
                              p.instanceId,
                              p.activeFlow!.flowId,
                            );
                            const list = await window.chronicleApi.listProviders();
                            setProviders(list);
                          })
                        }
                      >
                        Complete
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-compact"
                        disabled={busy}
                        onClick={() =>
                          void runAction(async () => {
                            await window.chronicleApi.cancelProviderAuth(
                              p.instanceId,
                              p.activeFlow!.flowId,
                            );
                            const list = await window.chronicleApi.listProviders();
                            setProviders(list);
                          })
                        }
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {p.models.length > 0 && (
                  <div className="model-chip-list">
                    {p.models.map((m) => (
                      <span
                        key={m.slug}
                        className={`model-chip ${m.selectable ? 'is-ready' : 'is-disabled'}`}
                        title={m.disabledReason ?? 'Ready for structured chapter generation'}
                      >
                        {m.name}
                        {m.disabledReason ? ` (${m.disabledReason})` : ''}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="panel">
        <h2>Role Model Assignment &amp; Fallbacks</h2>
        <p className="muted-copy">
          Assign models to each role. Incompatible or unauthenticated models appear
          disabled with an explicit reason. Your choices are saved on this device.
        </p>
        {renderSlotEditor(
          'narrator',
          'Narrator',
          'Runs living campaigns: plays the world in conversation, edits world state, spawns helpers and starts battles. Works in the campaign workspace with its native tools.',
        )}
        {renderSlotEditor(
          'helper',
          'Helper agents',
          'Build content as code while you play — systems, creatures, abilities, maps, panels, visuals and sound — and repair modules that fail. Full native tools (shell, files, code execution) in the campaign workspace.',
        )}
        {settings && (
          <div className="slot-card">
            <label className="slot-controls">Helpers working in parallel
              <select data-testid="helper-concurrency-select" value={settings.helperConcurrency ?? 3} onChange={(e) => setSettings((prev) => prev && { ...prev, helperConcurrency: Number(e.target.value) })}>
                {[1, 2, 3, 4, 6, 8].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
        )}

        {renderSlotEditor(
          'architect',
          'Architect (Chapter Forge)',
          'Plans single forged chapters: map archetype, objective, turn limit and roster.',
        )}
        {renderSlotEditor(
          'chronicler',
          'Chronicler (Chapter Forge)',
          'Compiles Rule IR abilities and statuses for forged chapters and repairs them.',
        )}

        {settings && (
          <div className="slot-card">
            <div className="panel-header-row">
              <h3>Ordered Fallbacks</h3>
              <button
                type="button"
                className="btn btn-ghost btn-compact"
                onClick={addFallback}
                disabled={busy || settings.fallbacks.length >= 6}
              >
                + Add Fallback
              </button>
            </div>
            {settings.fallbacks.length === 0 ? (
              <p className="muted-copy">No extra fallback models configured (Local Fallback still applies).</p>
            ) : (
              <div className="fallback-list">
                {settings.fallbacks.map((fb, idx) => {
                  const prov = providers.find((p) => p.instanceId === fb.providerId);
                  const models = prov?.models ?? [];
                  return (
                    <div key={idx} className="fallback-row">
                      <span>#{idx + 1}</span>
                      <select
                        value={fb.providerId}
                        onChange={(e) => updateFallback(idx, { providerId: e.target.value })}
                      >
                        {providers.length === 0 && <option value={fb.providerId}>{fb.providerId}</option>}
                        {providers.map((p) => (
                          <option key={p.instanceId} value={p.instanceId}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <select
                        value={fb.model}
                        onChange={(e) => updateFallback(idx, { model: e.target.value })}
                      >
                        {!models.some((m) => m.slug === fb.model) && (
                          <option value={fb.model}>{fb.model}</option>
                        )}
                        {models.map((m) => (
                          <option key={m.slug} value={m.slug} disabled={!m.selectable}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                      <select
                        value={fb.effort ?? ''}
                        onChange={(e) =>
                          updateFallback(idx, { effort: e.target.value as ModelEffortOption })
                        }
                      >
                        {DEFAULT_EFFORTS.map((ef) => (
                          <option key={ef || 'default'} value={ef}>
                            {ef || 'Default'}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn btn-ghost btn-compact"
                        disabled={idx === 0}
                        onClick={() => moveFallback(idx, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-compact"
                        disabled={idx === settings.fallbacks.length - 1}
                        onClick={() => moveFallback(idx, 1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-compact"
                        onClick={() => removeFallback(idx)}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="campaign-actions">
          <button
            type="button"
            className="btn btn-primary"
            data-testid="save-provider-settings-btn"
            disabled={busy || !settings}
            onClick={() =>
              settings &&
              void runAction(async () => {
                const saved = await window.chronicleApi.saveProviderSettings(settings);
                setSettings(saved);
              }, 'Provider & model preferences saved to SQLite.')
            }
          >
            Save Preferences
          </button>
        </div>
      </div>
    </section>
  );
}
