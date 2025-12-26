import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ResourceLoader } from './resource-loader';

describe('ResourceLoader', () => {
  const testDir = join(process.cwd(), 'temp_test_project');
  const keystoneDir = join(testDir, '.keystone');
  const workflowDir = join(keystoneDir, 'workflows');
  const testFile = join(workflowDir, 'test.yaml');

  beforeAll(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    mkdirSync(workflowDir, { recursive: true });
    writeFileSync(testFile, 'name: test-workflow');
  });

  afterAll(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  test('should read local file if it exists', () => {
    const content = ResourceLoader.readFile(testFile);
    expect(content).toBe('name: test-workflow');
  });

  test('exists() should return true for local files', () => {
    expect(ResourceLoader.exists(testFile)).toBe(true);
    expect(ResourceLoader.exists(workflowDir)).toBe(true);
  });

  test('listDirectory() should include local files', () => {
    const files = ResourceLoader.listDirectory(workflowDir);
    expect(files).toContain('test.yaml');
  });

  test('isDirectory() should work for local paths', () => {
    expect(ResourceLoader.isDirectory(workflowDir)).toBe(true);
    expect(ResourceLoader.isDirectory(testFile)).toBe(false);
  });

  test('should expose embedded assets manifest when available', () => {
    const assets = ResourceLoader.getEmbeddedAssets();
    const keys = Object.keys(assets);

    // Bundled assets only exist in compiled builds; dev/test may be empty.
    if (keys.length === 0) {
      expect(keys.length).toBe(0);
      return;
    }

    expect(Object.values(assets).every((value) => typeof value === 'string')).toBe(true);
  });
});
