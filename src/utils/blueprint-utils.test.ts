import { describe, expect, it } from 'bun:test';
import type { Blueprint } from '../parser/schema';
import { BlueprintUtils } from './blueprint-utils';

describe('BlueprintUtils', () => {
  const mockBlueprint: Blueprint = {
    architecture: {
      description: 'Test Architecture',
      patterns: ['MVC'],
    },
    files: [
      { path: 'src/index.ts', purpose: 'Main entry point' },
      { path: 'src/app.ts', purpose: 'App logic' },
    ],
  };

  it('should calculate a stable hash', () => {
    const hash1 = BlueprintUtils.calculateHash(mockBlueprint);
    const hash2 = BlueprintUtils.calculateHash({
      ...mockBlueprint,
      files: [...mockBlueprint.files].reverse(), // Different order
    });
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it('should detect missing files', () => {
    const generated = [{ path: 'src/index.ts' }];
    const diffs = BlueprintUtils.detectDrift(mockBlueprint, generated);
    expect(diffs).toContain('Missing file: src/app.ts');
  });

  it('should detect extra files', () => {
    const generated = [{ path: 'src/index.ts' }, { path: 'src/app.ts' }, { path: 'src/extra.ts' }];
    const diffs = BlueprintUtils.detectDrift(mockBlueprint, generated);
    expect(diffs).toContain('Extra file not in blueprint: src/extra.ts');
  });

  it('should detect purpose drift', () => {
    const generated = [
      { path: 'src/index.ts', purpose: 'Different purpose' },
      { path: 'src/app.ts', purpose: 'App logic' },
    ];
    const diffs = BlueprintUtils.detectDrift(mockBlueprint, generated);
    expect(diffs).toContain(
      'Purpose drift in src/index.ts: expected "Main entry point", got "Different purpose"'
    );
  });
});
