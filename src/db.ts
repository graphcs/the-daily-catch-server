import Database from 'better-sqlite3';
import path from 'path';
import { Story, DeepContent } from './types';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'dailycatch.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate();
  }
  return db;
}

function migrate() {
  const d = getDb();

  d.exec(`
    CREATE TABLE IF NOT EXISTS batches (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL DEFAULT 'running'
    );

    CREATE TABLE IF NOT EXISTS stories (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      energy_mode TEXT NOT NULL,
      rank INTEGER NOT NULL,
      story_json TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      FOREIGN KEY (batch_id) REFERENCES batches(id)
    );

    CREATE INDEX IF NOT EXISTS idx_stories_lookup
      ON stories(topic, energy_mode, batch_id);

    CREATE TABLE IF NOT EXISTS deep_content (
      story_id TEXT PRIMARY KEY,
      content_json TEXT NOT NULL,
      generated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS test_codes (
      code TEXT PRIMARY KEY,
      days_granted INTEGER NOT NULL,
      max_uses INTEGER NOT NULL DEFAULT 0,
      current_uses INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );
  `);

  // Seed default test code if not exists
  const existing = d.prepare('SELECT code FROM test_codes WHERE code = ?').get('DEEPCATCH30');
  if (!existing) {
    d.prepare(
      'INSERT INTO test_codes (code, days_granted, max_uses, current_uses, active) VALUES (?, ?, ?, ?, ?)'
    ).run('DEEPCATCH30', 30, 0, 0, 1);
  }
}

// --- Batch operations ---

export function createBatch(batchId: string): void {
  getDb().prepare(
    'INSERT INTO batches (id, started_at, status) VALUES (?, ?, ?)'
  ).run(batchId, new Date().toISOString(), 'running');
}

export function completeBatch(batchId: string, status: 'completed' | 'failed'): void {
  getDb().prepare(
    'UPDATE batches SET completed_at = ?, status = ? WHERE id = ?'
  ).run(new Date().toISOString(), status, batchId);
}

export function getLatestCompletedBatchId(): string | null {
  const row = getDb().prepare(
    "SELECT id FROM batches WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1"
  ).get() as { id: string } | undefined;
  return row?.id ?? null;
}

export function getLastRefreshTime(): string | null {
  const row = getDb().prepare(
    "SELECT completed_at FROM batches WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1"
  ).get() as { completed_at: string } | undefined;
  return row?.completed_at ?? null;
}

// --- Story operations ---

export function saveStories(stories: Story[], topic: string, energyMode: string, batchId: string): void {
  const stmt = getDb().prepare(
    'INSERT OR REPLACE INTO stories (id, topic, energy_mode, rank, story_json, generated_at, batch_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const now = new Date().toISOString();
  for (let i = 0; i < stories.length; i++) {
    stmt.run(stories[i].id, topic, energyMode, i + 1, JSON.stringify(stories[i]), now, batchId);
  }
}

export function getStoriesForTopic(topic: string, energyMode: string, batchId: string, limit: number): Story[] {
  const rows = getDb().prepare(
    'SELECT story_json FROM stories WHERE topic = ? AND energy_mode = ? AND batch_id = ? ORDER BY rank ASC LIMIT ?'
  ).all(topic, energyMode, batchId, limit) as { story_json: string }[];
  return rows.map(r => JSON.parse(r.story_json));
}

export function getStoryById(storyId: string): Story | null {
  const row = getDb().prepare(
    'SELECT story_json FROM stories WHERE id = ? LIMIT 1'
  ).get(storyId) as { story_json: string } | undefined;
  return row ? JSON.parse(row.story_json) : null;
}

export function getStoriesForTopics(topics: string[], batchId: string): Story[] {
  const placeholders = topics.map(() => '?').join(',');
  const rows = getDb().prepare(
    `SELECT story_json FROM stories WHERE topic IN (${placeholders}) AND energy_mode = 'all' AND batch_id = ? ORDER BY topic, rank ASC`
  ).all(...topics, batchId) as { story_json: string }[];
  return rows.map(r => JSON.parse(r.story_json));
}

// --- Deep content operations ---

export function saveDeepContent(storyId: string, content: DeepContent): void {
  getDb().prepare(
    'INSERT OR REPLACE INTO deep_content (story_id, content_json, generated_at) VALUES (?, ?, ?)'
  ).run(storyId, JSON.stringify(content), new Date().toISOString());
}

export function getDeepContent(storyId: string): DeepContent | null {
  const row = getDb().prepare(
    'SELECT content_json FROM deep_content WHERE story_id = ? LIMIT 1'
  ).get(storyId) as { content_json: string } | undefined;
  return row ? JSON.parse(row.content_json) : null;
}

// --- Cleanup ---

export function deleteOldBatches(keepCount: number = 3): void {
  const batchIds = getDb().prepare(
    "SELECT id FROM batches WHERE status = 'completed' ORDER BY completed_at DESC"
  ).all() as { id: string }[];

  if (batchIds.length <= keepCount) return;

  const toDelete = batchIds.slice(keepCount).map(b => b.id);
  const placeholders = toDelete.map(() => '?').join(',');
  getDb().prepare(`DELETE FROM stories WHERE batch_id IN (${placeholders})`).run(...toDelete);
  getDb().prepare(`DELETE FROM batches WHERE id IN (${placeholders})`).run(...toDelete);

  // Clean up orphaned deep content
  getDb().prepare(
    'DELETE FROM deep_content WHERE story_id NOT IN (SELECT id FROM stories)'
  ).run();
}

// --- Test code operations ---

export interface TestCode {
  code: string;
  days_granted: number;
  max_uses: number;
  current_uses: number;
  active: number;
}

export function redeemTestCode(code: string): { valid: boolean; daysGranted?: number; expiresAt?: string; error?: string } {
  const row = getDb().prepare(
    'SELECT * FROM test_codes WHERE code = ?'
  ).get(code) as TestCode | undefined;

  if (!row) return { valid: false, error: 'Invalid code' };
  if (!row.active) return { valid: false, error: 'This code is no longer active' };
  if (row.max_uses > 0 && row.current_uses >= row.max_uses) {
    return { valid: false, error: 'This code has reached its usage limit' };
  }

  // Increment usage count
  getDb().prepare('UPDATE test_codes SET current_uses = current_uses + 1 WHERE code = ?').run(code);

  // Calculate expiry date
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + row.days_granted);

  return {
    valid: true,
    daysGranted: row.days_granted,
    expiresAt: expiresAt.toISOString(),
  };
}

export function listTestCodes(): TestCode[] {
  return getDb().prepare('SELECT * FROM test_codes ORDER BY code').all() as TestCode[];
}

export function createTestCode(code: string, daysGranted: number, maxUses: number): void {
  getDb().prepare(
    'INSERT OR REPLACE INTO test_codes (code, days_granted, max_uses, current_uses, active) VALUES (?, ?, ?, 0, 1)'
  ).run(code, daysGranted, maxUses);
}
