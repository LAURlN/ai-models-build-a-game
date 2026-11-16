import { useEffect, useState } from 'react';
import { AtlasArt } from './AtlasArt';
import type { BattleSnapshot, GenerationProgressEvent } from '../../shared/contracts';

interface CampaignScreenProps {
  onChapterLaunched: (snapshot: BattleSnapshot) => void;
}

const STARTER_PREMISES = [
  'Hold the flooded stone bridge against ironclad raiders with an ember surge blade.',
  'Seize the sunken fortress gate before the crimson vanguard reinforces.',
  'Ambush a twilight patrol in the misted forest with swift archers.',
];

export function CampaignScreen({ onChapterLaunched }: CampaignScreenProps) {
  const [premise, setPremise] = useState(
    'Hold the ashen bridge against iron raiders while mastering a risky temporal surge.',
  );
  const [progress, setProgress] = useState<GenerationProgressEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void window.chronicleApi
      .getGenerationStatus()
      .then((ev) => {
        if (active) setProgress(ev);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });

    const unsub = window.chronicleApi.onGenerationProgress((ev) => {
      if (!active) return;
      setProgress(ev);
      if (['completed', 'fallback', 'cancelled', 'failed'].includes(ev.stage)) {
        setBusy(false);
      }
    });
    return () => {
      active = false;
      unsub();
    };
  }, []);

  const isRunning =
    busy ||
    (progress !== null &&
      ['planning', 'building', 'validating', 'repairing', 'publishing'].includes(progress.stage));

  const handleGenerate = async () => {
    setError(null);
    setBusy(true);
    try {
      const started = await window.chronicleApi.startGeneration(premise);
      setProgress((prev) => ({
        attemptId: started.attemptId,
        epoch: started.epoch,
        stage: 'planning',
        message: 'Architect is drafting the chapter layout & roster...',
        ...(prev?.preview ? { preview: prev.preview } : {}),
      }));
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleCancel = async () => {
    if (!progress?.attemptId) return;
    try {
      await window.chronicleApi.cancelGeneration(progress.attemptId);
      setBusy(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handlePlay = async () => {
    if (!progress?.preview) return;
    setError(null);
    try {
      const snap = await window.chronicleApi.launchChapter(progress.preview.battleState);
      onChapterLaunched(snap);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const preview = progress?.preview;

  return (
    <section className="subscreen-grid" data-testid="campaign-panel">
      <div className="panel campaign-composer">
        <span className="eyebrow">AN UNWRITTEN WORLD</span><h2>Where does your story begin?</h2>
        <p className="muted-copy">
          Describe a world, a company and a conflict. Your Architect shapes the battlefield; your Chronicler gives it a voice. A local chapter is always available offline.
        </p>

        <div className="starter-chips">
          {STARTER_PREMISES.map((sample, idx) => (
            <button
              key={idx}
              type="button"
              className="btn btn-ghost btn-compact"
              onClick={() => setPremise(sample)}
              disabled={isRunning}
            >
              {['The flooded bridge', 'The sunken fortress', 'The twilight patrol'][idx]}
            </button>
          ))}
        </div>

        <label className="field-label" htmlFor="premise-input">
          Setting &amp; Tactical Premise
        </label>
        <textarea
          id="premise-input"
          data-testid="premise-input"
          className="premise-textarea"
          rows={4}
          maxLength={800}
          value={premise}
          onChange={(e) => setPremise(e.target.value)}
          placeholder="Describe terrain, forces, objective, and tactical twist..."
        />

        <div className="campaign-actions">
          <button
            type="button"
            className="btn btn-primary"
            data-testid="generate-chapter-btn"
            disabled={isRunning || premise.trim().length === 0}
            onClick={() => void handleGenerate()}
          >
            {isRunning ? 'Forging Chapter…' : 'Generate Chapter'}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            data-testid="cancel-generation-btn"
            disabled={!isRunning || !progress?.attemptId}
            onClick={() => void handleCancel()}
          >
            Cancel
          </button>
        </div>

        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}

        <div className={`stage-box ${isRunning ? 'is-generating' : ''}`} role="status" data-testid="stage-indicator" data-stage={progress?.stage ?? 'idle'}>
          <div className="generation-track" aria-hidden="true">{['planning','building','validating','publishing'].map((stage,i)=><span key={stage} className={progress?.stage === stage ? 'is-current' : ''}>{i+1}<small>{['Plan','Build','Validate','Publish'][i]}</small></span>)}</div><strong>Stage: {(progress?.stage ?? 'idle').toUpperCase()}</strong>
          <span>{progress?.message ?? 'Ready to forge a new chapter.'}</span>
        </div>
      </div>

      <div className="panel campaign-preview" data-testid="chapter-preview">
        <span className="eyebrow">ORDERS &amp; DEPLOYMENT</span><h2>Chapter briefing</h2>
        {!preview ? (
          <div className="empty-briefing"><AtlasArt small/><p>A new page awaits.<br/>Your chapter briefing will appear here.</p></div>
        ) : (
          <div className="preview-body">
            <div className="preview-header">
              <div>
                <h3 data-testid="preview-title">{preview.title}</h3>
                <p className="muted-copy">{preview.summary}</p>
              </div>
              <span
                className={`pill ${preview.source === 'local_fallback' ? 'badge-fallback' : 'badge-generated'}`}
                data-testid="chapter-source-badge"
              >
                {preview.source === 'local_fallback'
                  ? 'Local Fallback'
                  : `Generated (${preview.providerUsed} · ${preview.modelUsed})`}
              </span>
            </div>

            {preview.repaired && <div className="pill badge-repaired">Repaired Rule IR (1 pass)</div>}
            {preview.fallbackReason && (
              <p className="muted-copy" data-testid="fallback-reason">
                Fallback reason: {preview.fallbackReason}
              </p>
            )}

            <div className="preview-meta">
              <span>
                <strong>Map:</strong> {preview.archetype.replaceAll('_', ' ')}
              </span>
              <span>
                <strong>Objective:</strong> {preview.objective.toUpperCase()}
              </span>
              <span>
                <strong>Turn limit:</strong> {preview.battleState.maxTurns}
              </span>
            </div>

            <div className="ability-box">
              <strong>Signature Ability — {preview.abilityName}</strong>
              <p>{preview.abilityRulesText}</p>
            </div>

            <div className="roster-preview">
              <strong>Deployed Units</strong>
              <ul>
                {preview.units.map((u, idx) => (
                  <li key={idx} className={`roster-chip faction-${u.faction}`}>
                    <strong>{u.name}</strong> ({u.title}) · {u.faction} · {u.weaponTag}
                  </li>
                ))}
              </ul>
            </div>

            <button
              type="button"
              className="btn btn-primary btn-large"
              data-testid="play-chapter-btn"
              onClick={() => void handlePlay()}
            >
              Play Chapter
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
