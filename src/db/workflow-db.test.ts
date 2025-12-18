import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { WorkflowDb } from './workflow-db';

describe('WorkflowDb', () => {
  const dbPath = ':memory:';
  let db: WorkflowDb;

  beforeAll(() => {
    db = new WorkflowDb(dbPath);
  });

  afterAll(() => {
    db.close();
  });

  it('should create and retrieve a run', async () => {
    const runId = 'run-1';
    await db.createRun(runId, 'test-wf', { input: 1 });
    const run = db.getRun(runId);
    expect(run).toBeDefined();
    expect(run?.workflow_name).toBe('test-wf');
    expect(JSON.parse(run?.inputs || '{}')).toEqual({ input: 1 });
  });

  it('should update run status', async () => {
    const runId = 'run-2';
    await db.createRun(runId, 'test-wf', {});
    await db.updateRunStatus(runId, 'completed', { result: 'ok' });
    const run = db.getRun(runId);
    expect(run?.status).toBe('completed');
    expect(JSON.parse(run?.outputs || '{}')).toEqual({ result: 'ok' });
  });

  it('should create and list steps', async () => {
    const runId = 'run-3';
    await db.createRun(runId, 'test-wf', {});
    const stepId = 'step-a';
    await db.createStep('exec-1', runId, stepId);
    await db.startStep('exec-1');
    await db.completeStep('exec-1', 'success', { out: 'val' });

    const steps = db.getStepsByRun(runId);
    expect(steps).toHaveLength(1);
    expect(steps[0].step_id).toBe(stepId);
    expect(steps[0].status).toBe('success');
  });

  it('should handle iterations in steps', async () => {
    const runId = 'run-4';
    await db.createRun(runId, 'test-wf', {});
    await db.createStep('exec-i0', runId, 'loop', 0);
    await db.createStep('exec-i1', runId, 'loop', 1);

    const step0 = db.getStepByIteration(runId, 'loop', 0);
    expect(step0).toBeDefined();
    expect(step0?.iteration_index).toBe(0);

    const steps = db.getStepsByRun(runId);
    expect(steps).toHaveLength(2);
  });

  it('should increment retry count', async () => {
    const runId = 'run-5';
    await db.createRun(runId, 'test-wf', {});
    await db.createStep('exec-r', runId, 'retry-step');
    await db.incrementRetry('exec-r');
    await db.incrementRetry('exec-r');

    const steps = db.getStepsByRun(runId);
    expect(steps[0].retry_count).toBe(2);
  });

  it('should list runs with limit', async () => {
    await db.createRun('run-l1', 'wf', {});
    await db.createRun('run-l2', 'wf', {});
    const runs = db.listRuns(1);
    expect(runs).toHaveLength(1);
  });

  it('should vacuum the database', async () => {
    await db.vacuum();
    // If it doesn't throw, it's successful
  });

  it('should prune old runs', async () => {
    const runId = 'old-run';
    await db.createRun(runId, 'test-wf', {});

    // We can't easily change the date via public API,
    // but we can check that it doesn't delete recent runs
    const deleted = await db.pruneRuns(30);
    expect(deleted).toBe(0);

    const run = db.getRun(runId);
    expect(run).toBeDefined();
  });
});
