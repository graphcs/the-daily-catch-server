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
  `);
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
