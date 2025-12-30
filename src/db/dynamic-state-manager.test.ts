/**
 * Tests for DynamicStateManager
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  type DynamicPlan,
  DynamicStateManager,
  type DynamicStepState,
} from './dynamic-state-manager.ts';
import { WorkflowDb } from './workflow-db.ts';

describe('DynamicStateManager', () => {
  let db: WorkflowDb;
  let stateManager: DynamicStateManager;
  const testDir = join(import.meta.dir, '.test-dynamic-state');
  const testDbPath = join(testDir, 'test.db');

  beforeEach(async () => {
    // Clean up any existing test db
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    mkdirSync(testDir, { recursive: true });

    db = new WorkflowDb(testDbPath);
    stateManager = new DynamicStateManager(db);

    // Create a workflow run for foreign key constraint
    await db.createRun('test-run-1', 'test-workflow', { input: 'value' });
  });

  afterEach(() => {
    db.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe('create', () => {
    it('should create a new dynamic state', async () => {
      const state = await stateManager.create({
        runId: 'test-run-1',
        stepId: 'dynamic-step-1',
        workflowId: 'wf-123',
      });

      expect(state.id).toBeDefined();
      expect(state.runId).toBe('test-run-1');
      expect(state.stepId).toBe('dynamic-step-1');
      expect(state.workflowId).toBe('wf-123');
      expect(state.status).toBe('planning');
      expect(state.generatedPlan.steps).toEqual([]);
      expect(state.currentStepIndex).toBe(0);
      expect(state.startedAt).toBeDefined();
    });

    it('should create state defaulting workflowId to runId', async () => {
      const state = await stateManager.create({
        runId: 'test-run-1',
        stepId: 'dynamic-step-2',
      });

      expect(state.workflowId).toBe('test-run-1');
    });
  });

  describe('load', () => {
    it('should load existing state', async () => {
      const created = await stateManager.create({
        runId: 'test-run-1',
        stepId: 'dynamic-step-1',
      });

      const loaded = await stateManager.load('test-run-1', 'dynamic-step-1');

      expect(loaded).not.toBeNull();
      expect(loaded?.id).toBe(created.id);
      expect(loaded?.status).toBe('planning');
    });

    it('should return null for non-existent state', async () => {
      const loaded = await stateManager.load('test-run-1', 'non-existent');
      expect(loaded).toBeNull();
    });
  });

  describe('loadById', () => {
    it('should load state by ID', async () => {
      const created = await stateManager.create({
        runId: 'test-run-1',
        stepId: 'dynamic-step-1',
      });

      const loaded = await stateManager.loadById(created.id);

      expect(loaded).not.toBeNull();
      expect(loaded?.id).toBe(created.id);
    });
  });

  describe('setPlan', () => {
    it('should set the plan and create step executions', async () => {
      const state = await stateManager.create({
        runId: 'test-run-1',
        stepId: 'dynamic-step-1',
      });

      const plan: DynamicPlan = {
        steps: [
          { id: 'step1', name: 'First step', type: 'shell', run: 'echo hello' },
          {
            id: 'step2',
            name: 'Second step',
            type: 'llm',
            agent: 'test',
            prompt: 'do something',
            needs: ['step1'],
          },
        ],
        notes: 'Test plan',
      };

      await stateManager.setPlan(state.id, plan);

      // Verify state was updated
      const loaded = await stateManager.loadById(state.id);
      expect(loaded?.status).toBe('executing');
      expect(loaded?.generatedPlan.steps.length).toBe(2);
      expect(loaded?.generatedPlan.notes).toBe('Test plan');

      // Verify step executions were created
      const executions = await stateManager.getStepExecutions(state.id);
      expect(executions.length).toBe(2);
      expect(executions[0].stepId).toBe('step1');
      expect(executions[0].status).toBe('pending');
      expect(executions[0].executionOrder).toBe(0);
      expect(executions[1].stepId).toBe('step2');
      expect(executions[1].executionOrder).toBe(1);
    });
  });

  describe('updateProgress', () => {
    it('should update the current step index', async () => {
      const state = await stateManager.create({
        runId: 'test-run-1',
        stepId: 'dynamic-step-1',
      });

      await stateManager.updateProgress(state.id, 3);

      const loaded = await stateManager.loadById(state.id);
      expect(loaded?.currentStepIndex).toBe(3);
    });
  });

  describe('startStep and completeStep', () => {
    it('should track step execution lifecycle', async () => {
      const state = await stateManager.create({
        runId: 'test-run-1',
        stepId: 'dynamic-step-1',
      });

      const plan: DynamicPlan = {
        steps: [{ id: 'step1', name: 'First step', type: 'shell', run: 'echo hello' }],
      };
      await stateManager.setPlan(state.id, plan);

      // Start the step
      await stateManager.startStep(state.id, 'step1');

      let executions = await stateManager.getStepExecutions(state.id);
      expect(executions[0].status).toBe('running');
      expect(executions[0].startedAt).toBeDefined();

      // Complete the step
      await stateManager.completeStep(state.id, 'step1', {
        status: 'success',
        output: { result: 'hello' },
      });

      executions = await stateManager.getStepExecutions(state.id);
      expect(executions[0].status).toBe('success');
      expect(executions[0].output).toEqual({ result: 'hello' });
      expect(executions[0].completedAt).toBeDefined();
    });

    it('should handle failed steps', async () => {
      const state = await stateManager.create({
        runId: 'test-run-1',
        stepId: 'dynamic-step-1',
      });

      const plan: DynamicPlan = {
        steps: [{ id: 'step1', name: 'First step', type: 'shell', run: 'exit 1' }],
      };
      await stateManager.setPlan(state.id, plan);
      await stateManager.startStep(state.id, 'step1');

      await stateManager.completeStep(state.id, 'step1', {
        status: 'failed',
        error: 'Command exited with code 1',
      });

      const executions = await stateManager.getStepExecutions(state.id);
      expect(executions[0].status).toBe('failed');
      expect(executions[0].error).toBe('Command exited with code 1');
    });
  });

  describe('finish', () => {
    it('should mark state as completed', async () => {
      const state = await stateManager.create({
        runId: 'test-run-1',
        stepId: 'dynamic-step-1',
      });

      await stateManager.finish(state.id, 'completed');

      const loaded = await stateManager.loadById(state.id);
      expect(loaded?.status).toBe('completed');
      expect(loaded?.completedAt).toBeDefined();
    });

    it('should mark state as failed with error', async () => {
      const state = await stateManager.create({
        runId: 'test-run-1',
        stepId: 'dynamic-step-1',
      });

      await stateManager.finish(state.id, 'failed', 'Something went wrong');

      const loaded = await stateManager.loadById(state.id);
      expect(loaded?.status).toBe('failed');
      expect(loaded?.error).toBe('Something went wrong');
    });
  });

  describe('getStepResultsMap', () => {
    it('should return completed steps as a map', async () => {
      const state = await stateManager.create({
        runId: 'test-run-1',
        stepId: 'dynamic-step-1',
      });

      const plan: DynamicPlan = {
        steps: [
          { id: 'step1', name: 'First', type: 'shell', run: 'echo 1' },
          { id: 'step2', name: 'Second', type: 'shell', run: 'echo 2' },
        ],
      };
      await stateManager.setPlan(state.id, plan);

      // Complete first step
      await stateManager.startStep(state.id, 'step1');
      await stateManager.completeStep(state.id, 'step1', {
        status: 'success',
        output: { value: 1 },
      });

      const resultsMap = await stateManager.getStepResultsMap(state.id);

      expect(resultsMap.size).toBe(1); // Only completed steps
      expect(resultsMap.get('step1')).toEqual({
        output: { value: 1 },
        status: 'success',
        error: undefined,
      });
      expect(resultsMap.has('step2')).toBe(false); // Still pending
    });
  });

  describe('listActive', () => {
    it('should list active states', async () => {
      await stateManager.create({
        runId: 'test-run-1',
        stepId: 'step-1',
      });

      const state2 = await stateManager.create({
        runId: 'test-run-1',
        stepId: 'step-2',
      });

      // Complete one
      await stateManager.finish(state2.id, 'completed');

      const active = await stateManager.listActive();
      expect(active.length).toBe(1);
      expect(active[0].stepId).toBe('step-1');
    });
  });

  describe('listByRun', () => {
    it('should list states for a run', async () => {
      await stateManager.create({
        runId: 'test-run-1',
        stepId: 'step-1',
      });
      await stateManager.create({
        runId: 'test-run-1',
        stepId: 'step-2',
      });

      const states = await stateManager.listByRun('test-run-1');
      expect(states.length).toBe(2);
    });
  });
});
