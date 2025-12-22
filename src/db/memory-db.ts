import { randomUUID } from 'node:crypto';
import * as sqliteVec from 'sqlite-vec';
import sqlite3 from 'sqlite3';

export interface MemoryEntry {
  id: string;
  text: string;
  metadata: Record<string, unknown>;
  distance?: number;
}

export class MemoryDb {
  private db: sqlite3.Database;

  constructor(public readonly dbPath = '.keystone/memory.db') {
    this.db = new sqlite3.Database(dbPath === ':memory:' ? ':memory:' : dbPath);

    // Load sqlite-vec extension
    sqliteVec.load(this.db);

    this.initSchema();
  }

  private initSchema(): void {
    // Create virtual table for vector search
    this.db.serialize(() => {
      this.db.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_memory USING vec0(
          id TEXT PRIMARY KEY,
          embedding FLOAT[384]
        );
      `);

      // Create Metadata table
      this.db.run(`
        CREATE TABLE IF NOT EXISTS memory_metadata (
          id TEXT PRIMARY KEY,
          text TEXT NOT NULL,
          metadata TEXT NOT NULL, -- JSON
          created_at TEXT NOT NULL
        );
      `);
    });
  }

  async store(
    text: string,
    embedding: number[],
    metadata: Record<string, unknown> = {}
  ): Promise<string> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        const vecStmt = this.db.prepare('INSERT INTO vec_memory(id, embedding) VALUES (?, ?)');
        vecStmt.run(id, new Float32Array(embedding));
        vecStmt.finalize();

        const metaStmt = this.db.prepare(
          'INSERT INTO memory_metadata(id, text, metadata, created_at) VALUES (?, ?, ?, ?)'
        );
        metaStmt.run(id, text, JSON.stringify(metadata), createdAt, (err: Error | null) => {
          if (err) reject(err);
          else resolve(id);
        });
        metaStmt.finalize();
      });
    });
  }

  async search(embedding: number[], limit = 5): Promise<MemoryEntry[]> {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          v.id, 
          v.distance,
          m.text,
          m.metadata
        FROM vec_memory v
        JOIN memory_metadata m ON v.id = m.id
        WHERE embedding MATCH ? AND k = ?
        ORDER BY distance
      `;

      // biome-ignore lint/suspicious/noExplicitAny: sqlite3 rows typing
      this.db.all(query, [new Float32Array(embedding), limit], (err: Error | null, rows: any[]) => {
        if (err) reject(err);
        else {
          resolve(
            (rows || []).map((r) => ({
              id: r.id,
              text: r.text,
              metadata: JSON.parse(r.metadata),
              distance: r.distance,
            }))
          );
        }
      });
    });
  }

  close(): void {
    this.db.close();
  }
}
