/** SQLite persistence for open-ended campaigns: world state, chat, battles with Turnwheel history, activity. */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ActivityTask, BattleState, CampaignState, CampaignSummary, ChatMessage } from '../../engine/types';

export type { CampaignSummary } from '../../engine/types';
export interface StoredBattle { state: BattleState; spent: number; history: BattleState[] }

export const HISTORY_LIMIT = 40;

export class CampaignStore {
  private readonly db: DatabaseSync;
  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
      CREATE TABLE IF NOT EXISTS campaigns (id TEXT PRIMARY KEY, title TEXT NOT NULL, updated_at INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chat (campaign_id TEXT NOT NULL, seq INTEGER NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, turn INTEGER NOT NULL, at INTEGER NOT NULL, kind TEXT, PRIMARY KEY (campaign_id, seq));
      CREATE TABLE IF NOT EXISTS world_battles (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, state TEXT NOT NULL, spent INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS world_battle_history (battle_id TEXT NOT NULL, idx INTEGER NOT NULL, state TEXT NOT NULL, PRIMARY KEY (battle_id, idx));
      CREATE TABLE IF NOT EXISTS activity (campaign_id TEXT NOT NULL, id TEXT NOT NULL, at INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (campaign_id, id));`);
  }

  private tx<T>(body: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = body(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  listCampaigns(): CampaignSummary[] {
    return (this.db.prepare('SELECT data FROM campaigns ORDER BY updated_at DESC').all() as { data: string }[]).map((row) => {
      const c = JSON.parse(row.data) as CampaignState;
      return { id: c.id, title: c.title, setting: c.setting, updatedAt: c.updatedAt, turn: c.turn, battles: c.battles.length, status: c.status, inBattle: !!c.activeBattleId };
    });
  }
  loadCampaign(id: string): CampaignState | null {
    const row = this.db.prepare('SELECT data FROM campaigns WHERE id=?').get(id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as CampaignState) : null;
  }
  saveCampaign(c: CampaignState): void {
    this.db.prepare('INSERT INTO campaigns (id, title, updated_at, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, updated_at=excluded.updated_at, data=excluded.data')
      .run(c.id, c.title, c.updatedAt, JSON.stringify(c));
  }
  deleteCampaign(id: string): void {
    this.tx(() => {
      const battles = this.db.prepare('SELECT id FROM world_battles WHERE campaign_id=?').all(id) as { id: string }[];
      for (const b of battles) this.db.prepare('DELETE FROM world_battle_history WHERE battle_id=?').run(b.id);
      for (const table of ['world_battles', 'chat', 'activity']) this.db.prepare(`DELETE FROM ${table} WHERE campaign_id=?`).run(id);
      this.db.prepare('DELETE FROM campaigns WHERE id=?').run(id);
    });
  }

  appendChat(campaignId: string, message: Omit<ChatMessage, 'seq'>): ChatMessage {
    return this.tx(() => {
      const row = this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS last FROM chat WHERE campaign_id=?').get(campaignId) as { last: number };
      const seq = Number(row.last) + 1;
      this.db.prepare('INSERT INTO chat (campaign_id, seq, role, text, turn, at, kind) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(campaignId, seq, message.role, message.text, message.turn, message.at, message.kind ?? null);
      return { ...message, seq };
    });
  }
  chatCount(campaignId: string): number {
    return Number((this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS last FROM chat WHERE campaign_id=?').get(campaignId) as { last: number }).last);
  }
  /** Messages with from <= seq <= to, ascending. */
  chatRange(campaignId: string, from: number, to: number): ChatMessage[] {
    const rows = this.db.prepare('SELECT seq, role, text, turn, at, kind FROM chat WHERE campaign_id=? AND seq>=? AND seq<=? ORDER BY seq').all(campaignId, from, to) as unknown as (ChatMessage & { kind: string | null })[];
    return rows.map(({ kind, ...rest }) => ({ ...rest, seq: Number(rest.seq), turn: Number(rest.turn), at: Number(rest.at), ...(kind ? { kind } : {}) }));
  }

  saveBattle(campaignId: string, state: BattleState, spent: number, boundaryIndex: number | null): void {
    this.tx(() => {
      const json = JSON.stringify(state);
      this.db.prepare('INSERT INTO world_battles (id, campaign_id, state, spent, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET state=excluded.state, spent=MAX(spent, excluded.spent), updated_at=excluded.updated_at')
        .run(state.id, campaignId, json, spent, Date.now());
      if (boundaryIndex !== null) {
        this.db.prepare('INSERT OR REPLACE INTO world_battle_history (battle_id, idx, state) VALUES (?, ?, ?)').run(state.id, boundaryIndex, json);
        this.db.prepare('DELETE FROM world_battle_history WHERE battle_id=? AND idx<=?').run(state.id, boundaryIndex - HISTORY_LIMIT);
      }
    });
  }
  truncateHistory(battleId: string, keepThrough: number): void {
    this.db.prepare('DELETE FROM world_battle_history WHERE battle_id=? AND idx>?').run(battleId, keepThrough);
  }
  loadBattle(id: string): (StoredBattle & { firstIndex: number }) | null {
    const row = this.db.prepare('SELECT state, spent FROM world_battles WHERE id=?').get(id) as { state: string; spent: number } | undefined;
    if (!row) return null;
    const rows = this.db.prepare('SELECT idx, state FROM world_battle_history WHERE battle_id=? ORDER BY idx').all(id) as { idx: number; state: string }[];
    return { state: JSON.parse(row.state) as BattleState, spent: Number(row.spent), history: rows.map((r) => JSON.parse(r.state) as BattleState), firstIndex: rows.length ? Number(rows[0]!.idx) : 0 };
  }
  dropBattleHistory(id: string): void { this.db.prepare('DELETE FROM world_battle_history WHERE battle_id=?').run(id); }

  saveActivity(campaignId: string, task: ActivityTask): void {
    this.db.prepare('INSERT OR REPLACE INTO activity (campaign_id, id, at, data) VALUES (?, ?, ?, ?)').run(campaignId, task.id, task.startedAt, JSON.stringify(task));
  }
  listActivity(campaignId: string, limit = 60): ActivityTask[] {
    const rows = this.db.prepare('SELECT data FROM activity WHERE campaign_id=? ORDER BY at DESC LIMIT ?').all(campaignId, limit) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as ActivityTask).reverse();
  }

  close(): void { this.db.close(); }
}
