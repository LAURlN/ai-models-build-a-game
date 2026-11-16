import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { computeStateHash, createInitialBattleState } from '../rules/battle';
import { RULES } from '../rules/ir';
import type {
  BattleState,
  EngineCommand,
  GeneratedChapterPreview,
  ProviderSettings,
} from '../shared/contracts';

export interface Boundary { state: BattleState; command: EngineCommand | null }
export interface SessionData { battleId: string; state: BattleState; history: Boundary[]; spent: number; branch: number }

export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = {
  architect: { providerId: 'codex', model: 'gpt-6.1-terra', effort: 'low' },
  chronicler: { providerId: 'codex', model: 'gpt-6.1-terra', effort: 'low' },
  fallbacks: [],
};

export function newSession(initialState?: BattleState): SessionData {
  const state = initialState ? structuredClone(initialState) : createInitialBattleState();
  return { battleId: randomUUID(), state, history: [{ state, command: null }], spent: 0, branch: 0 };
}

export interface JobLedgerRecord {
  jobId: string;
  attemptId: string;
  epoch: number;
  status: 'running' | 'published' | 'cancelled' | 'failed';
  kind: string;
  premise: string;
  preview: GeneratedChapterPreview | null;
}

/** One connection, in the game worker / host. Every acknowledgement follows a FULL synchronous SQLite commit. */
export class SaveStore {
  private readonly db: DatabaseSync;
  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS slots (id TEXT PRIMARY KEY, data TEXT NOT NULL, hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, branch INTEGER NOT NULL, command TEXT NOT NULL, hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS definitions (hash TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS faults (id INTEGER PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rewind_ledger (battleId TEXT PRIMARY KEY, spent INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS app_settings (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS generation_ledger (
        job_id TEXT PRIMARY KEY,
        attempt_id TEXT NOT NULL UNIQUE,
        epoch INTEGER NOT NULL,
        status TEXT NOT NULL,
        kind TEXT NOT NULL,
        premise TEXT NOT NULL,
        preview TEXT,
        updated_at INTEGER NOT NULL
      );`);
    const stmt = this.db.prepare('INSERT OR IGNORE INTO definitions VALUES (?, ?)');
    for (const definition of Object.values(RULES)) stmt.run(definition.contentHash, JSON.stringify(definition));
  }

  read(id = 'current'): SessionData | null {
    const row = this.db.prepare('SELECT data, hash FROM slots WHERE id=?').get(id);
    if (!row) return null;
    const data = JSON.parse(row.data as string) as SessionData;
    if (computeStateHash(data.state) !== row.hash || data.state.rulesVersion !== 'r03-1') throw new Error('Save integrity/version mismatch');
    const ledger = this.db.prepare('SELECT spent FROM rewind_ledger WHERE battleId=?').get(data.battleId);
    data.spent = Math.max(data.spent, (ledger?.spent as number) ?? 0);
    return data;
  }

  hasBookmark(): boolean { return !!this.db.prepare("SELECT id FROM slots WHERE id='bookmark'").get(); }

  commit(data: SessionData, command: unknown, bookmark = false, failBeforeCommit = false): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO rewind_ledger VALUES (?, ?) ON CONFLICT(battleId) DO UPDATE SET spent=MAX(spent, excluded.spent)').run(data.battleId, data.spent);
      const json = JSON.stringify(data), stateHash = computeStateHash(data.state);
      const write = this.db.prepare('INSERT OR REPLACE INTO slots VALUES (?, ?, ?)');
      write.run('current', json, stateHash);
      if (bookmark) write.run('bookmark', json, stateHash);
      this.db.prepare('INSERT INTO events(branch, command, hash) VALUES (?, ?, ?)').run(data.branch, JSON.stringify(command), stateHash);
      if (data.state.rulePack) {
        const defStmt = this.db.prepare('INSERT OR IGNORE INTO definitions VALUES (?, ?)');
        for (const def of Object.values(data.state.rulePack)) {
          defStmt.run(def.contentHash, JSON.stringify(def));
        }
      }
      if (failBeforeCommit) throw new Error('Injected interrupted commit');
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  recordFault(fault: unknown): void { this.db.prepare('INSERT INTO faults(data) VALUES (?)').run(JSON.stringify(fault)); }

  quarantined(): string[] {
    return [...new Set(this.db.prepare('SELECT data FROM faults').all().flatMap(row => (JSON.parse(row.data as string) as { definitionIds: string[] }).definitionIds))];
  }

  getProviderSettings(): ProviderSettings {
    const row = this.db.prepare("SELECT data FROM app_settings WHERE id='provider_settings'").get();
    if (!row) return structuredClone(DEFAULT_PROVIDER_SETTINGS);
    const parsed = JSON.parse(row.data as string) as Partial<ProviderSettings>;
    return {
      architect: parsed.architect ?? structuredClone(DEFAULT_PROVIDER_SETTINGS.architect),
      chronicler: parsed.chronicler ?? structuredClone(DEFAULT_PROVIDER_SETTINGS.chronicler),
      fallbacks: Array.isArray(parsed.fallbacks) ? parsed.fallbacks : [],
      ...(parsed.narrator ? { narrator: parsed.narrator } : {}),
      ...(parsed.helper ? { helper: parsed.helper } : {}),
      ...(typeof parsed.helperConcurrency === 'number' ? { helperConcurrency: parsed.helperConcurrency } : {}),
    };
  }

  saveProviderSettings(settings: ProviderSettings): ProviderSettings {
    const slot = (entry: ProviderSettings['architect']): ProviderSettings['architect'] => ({
      providerId: String(entry.providerId),
      model: String(entry.model),
      ...(entry.effort !== undefined ? { effort: entry.effort } : {}),
    });
    const clean: ProviderSettings = {
      ...(settings.narrator ? { narrator: slot(settings.narrator) } : {}),
      ...(settings.helper ? { helper: slot(settings.helper) } : {}),
      ...(typeof settings.helperConcurrency === 'number' ? { helperConcurrency: Math.max(1, Math.min(8, Math.round(settings.helperConcurrency))) } : {}),
      architect: {
        providerId: String(settings.architect.providerId),
        model: String(settings.architect.model),
        ...(settings.architect.effort !== undefined ? { effort: settings.architect.effort } : {}),
      },
      chronicler: {
        providerId: String(settings.chronicler.providerId),
        model: String(settings.chronicler.model),
        ...(settings.chronicler.effort !== undefined ? { effort: settings.chronicler.effort } : {}),
      },
      fallbacks: (settings.fallbacks ?? []).map((entry) => ({
        providerId: String(entry.providerId),
        model: String(entry.model),
        ...(entry.effort !== undefined ? { effort: entry.effort } : {}),
      })),
    };
    this.db.prepare("INSERT OR REPLACE INTO app_settings VALUES ('provider_settings', ?)").run(JSON.stringify(clean));
    return clean;
  }

  beginGenerationAttempt(jobId: string, attemptId: string, kind: string, premise: string): number {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const maxRow = this.db.prepare('SELECT COALESCE(MAX(epoch), 0) AS maxEpoch FROM generation_ledger').get() as { maxEpoch: number };
      const epoch = (maxRow?.maxEpoch ?? 0) + 1;
      const now = Date.now();
      // Supersede any earlier running jobs cleanly
      this.db.prepare("UPDATE generation_ledger SET status='cancelled', updated_at=? WHERE status='running' AND epoch < ?").run(now, epoch);
      this.db.prepare(
        'INSERT INTO generation_ledger (job_id, attempt_id, epoch, status, kind, premise, preview, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)',
      ).run(jobId, attemptId, epoch, 'running', kind, premise, now);
      this.db.prepare('INSERT OR REPLACE INTO jobs (id, data) VALUES (?, ?)').run(
        jobId,
        JSON.stringify({ jobId, attemptId, epoch, status: 'running', kind, premise }),
      );
      this.db.exec('COMMIT');
      return epoch;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * Compare-and-set publish into SQLite: refuses if epoch is stale, attemptId was already published,
   * or attemptId was cancelled/failed. Guarantees zero stale or duplicate republication.
   */
  tryPublishGeneration(jobId: string, attemptId: string, epoch: number, preview: GeneratedChapterPreview): boolean {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const latestEpochRow = this.db.prepare('SELECT COALESCE(MAX(epoch), 0) AS maxEpoch FROM generation_ledger').get() as { maxEpoch: number };
      if ((latestEpochRow?.maxEpoch ?? 0) !== epoch) {
        this.db.exec('ROLLBACK');
        return false;
      }
      const existing = this.db.prepare('SELECT status FROM generation_ledger WHERE job_id=? AND attempt_id=? AND epoch=?').get(jobId, attemptId, epoch) as { status: string } | undefined;
      if (!existing || existing.status !== 'running') {
        this.db.exec('ROLLBACK');
        return false;
      }
      const res = this.db.prepare(
        "UPDATE generation_ledger SET status='published', preview=?, updated_at=? WHERE job_id=? AND attempt_id=? AND epoch=? AND status='running'",
      ).run(JSON.stringify(preview), Date.now(), jobId, attemptId, epoch);
      if (Number(res.changes) !== 1) {
        this.db.exec('ROLLBACK');
        return false;
      }
      const defStmt = this.db.prepare('INSERT OR IGNORE INTO definitions VALUES (?, ?)');
      if (preview.battleState.rulePack) {
        for (const def of Object.values(preview.battleState.rulePack)) {
          defStmt.run(def.contentHash, JSON.stringify(def));
        }
      }
      this.db.prepare('INSERT OR REPLACE INTO jobs (id, data) VALUES (?, ?)').run(
        jobId,
        JSON.stringify({ jobId, attemptId, epoch, status: 'published', source: preview.source, title: preview.title }),
      );
      this.db.exec('COMMIT');
      return true;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  markGenerationCancelled(attemptId: string): boolean {
    const res = this.db.prepare(
      "UPDATE generation_ledger SET status='cancelled', updated_at=? WHERE attempt_id=? AND status='running'",
    ).run(Date.now(), attemptId);
    return Number(res.changes) > 0;
  }

  getLatestPublishedGeneration(): GeneratedChapterPreview | null {
    const row = this.db.prepare("SELECT preview FROM generation_ledger WHERE status='published' ORDER BY epoch DESC LIMIT 1").get() as { preview: string | null } | undefined;
    if (!row?.preview) return null;
    return JSON.parse(row.preview) as GeneratedChapterPreview;
  }

  listGenerationLedger(): JobLedgerRecord[] {
    const rows = this.db.prepare('SELECT job_id, attempt_id, epoch, status, kind, premise, preview FROM generation_ledger ORDER BY epoch DESC').all() as Array<{
      job_id: string; attempt_id: string; epoch: number; status: JobLedgerRecord['status']; kind: string; premise: string; preview: string | null;
    }>;
    return rows.map((r) => ({
      jobId: r.job_id,
      attemptId: r.attempt_id,
      epoch: r.epoch,
      status: r.status,
      kind: r.kind,
      premise: r.premise,
      preview: r.preview ? (JSON.parse(r.preview) as GeneratedChapterPreview) : null,
    }));
  }

  close(): void { this.db.close(); }
}
