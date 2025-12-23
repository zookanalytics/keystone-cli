import { afterAll, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import { MemoryDb } from './memory-db';

const TEST_DB = '.keystone/test-memory.db';

describe('MemoryDb', () => {
  // Clean up previous runs
  if (fs.existsSync(TEST_DB)) {
    fs.unlinkSync(TEST_DB);
  }

  const db = new MemoryDb(TEST_DB);

  afterAll(() => {
    db.close();
    if (fs.existsSync(TEST_DB)) {
      fs.unlinkSync(TEST_DB);
    }
  });

  test('should initialize and store embedding', async () => {
    const id = await db.store('hello world', Array(384).fill(0.1), { tag: 'test' });
    expect(id).toBeDefined();
    expect(typeof id).toBe('string');
  });

  test('should search and retrieve result', async () => {
    // Store another item to search for
    await db.store('search target', Array(384).fill(0.9), { tag: 'target' });

    const results = await db.search(Array(384).fill(0.9), 1);
    expect(results.length).toBe(1);
    expect(results[0].text).toBe('search target');
    expect(results[0].metadata).toEqual({ tag: 'target' });
  });

  test('should fail gracefully with invalid dimensions', async () => {
    // sqlite-vec requires fixed dimensions (384 defined in schema)
    // bun:sqlite usually throws an error for constraint violations
    let error: unknown;
    try {
      await db.store('fail', Array(10).fill(0));
    } catch (e) {
      error = e;
    }
    // We expect it to fail or at least be handled.
    // Note: sqlite-vec might coerce or zero-pad depending on strictness, but usually it enforces or fails.
    // The schema is float[384], so inserting 10 floats is a mismatch if strict.
    // However, if strict mode isn't on, it might just insert.
    // Let's checks if it throws. If not, we check if it stored anything useful or failed silently.
    // Actually, vec0 tables are strict about dimensions.
    expect(error).toBeDefined();
  });
});
