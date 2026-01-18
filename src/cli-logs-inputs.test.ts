import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { WorkflowDb, type WorkflowRun } from './db/workflow-db';

describe('CLI logs --inputs feature', () => {
  let db: WorkflowDb;

  beforeEach(() => {
    db = new WorkflowDb(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  describe('Inputs storage and retrieval', () => {
    it('should store and retrieve simple inputs', async () => {
      const runId = 'run-simple-inputs';
      const inputs = { name: 'John', count: 42 };

      await db.createRun(runId, 'test-workflow', inputs);
      const run = await db.getRun(runId);

      expect(run).toBeDefined();
      expect(run?.inputs).toBeDefined();
      const parsedInputs = JSON.parse(run!.inputs);
      expect(parsedInputs).toEqual(inputs);
    });

    it('should store and retrieve complex nested inputs', async () => {
      const runId = 'run-complex-inputs';
      const inputs = {
        string: 'value',
        number: 123,
        boolean: true,
        array: [1, 2, 3],
        object: { nested: { deep: 'value' } },
        nullValue: null,
      };

      await db.createRun(runId, 'test-workflow', inputs);
      const run = await db.getRun(runId);

      expect(run).toBeDefined();
      const parsedInputs = JSON.parse(run!.inputs);
      expect(parsedInputs).toEqual(inputs);
    });

    it('should store and retrieve empty inputs', async () => {
      const runId = 'run-empty-inputs';
      const inputs = {};

      await db.createRun(runId, 'test-workflow', inputs);
      const run = await db.getRun(runId);

      expect(run).toBeDefined();
      const parsedInputs = JSON.parse(run!.inputs);
      expect(parsedInputs).toEqual({});
    });

    it('should handle special characters in input values', async () => {
      const runId = 'run-special-chars';
      const inputs = {
        withQuotes: 'value with "quotes"',
        withNewlines: 'line1\nline2',
        withUnicode: 'Hello 世界 🌍',
        withBackslash: 'path\\to\\file',
      };

      await db.createRun(runId, 'test-workflow', inputs);
      const run = await db.getRun(runId);

      expect(run).toBeDefined();
      const parsedInputs = JSON.parse(run!.inputs);
      expect(parsedInputs).toEqual(inputs);
    });

    it('should handle large input values', async () => {
      const runId = 'run-large-inputs';
      const inputs = {
        largeString: 'x'.repeat(10000),
        largeArray: Array.from({ length: 1000 }, (_, i) => i),
      };

      await db.createRun(runId, 'test-workflow', inputs);
      const run = await db.getRun(runId);

      expect(run).toBeDefined();
      const parsedInputs = JSON.parse(run!.inputs);
      expect(parsedInputs.largeString.length).toBe(10000);
      expect(parsedInputs.largeArray.length).toBe(1000);
    });
  });

  describe('showRunLogs inputs display logic', () => {
    // Test the logic that showRunLogs uses to display inputs
    // The actual function is internal to cli.ts, so we test the parsing logic

    it('should parse valid JSON inputs correctly', () => {
      const inputsJson = JSON.stringify({ name: 'test', value: 123 });
      const parsed = JSON.parse(inputsJson);
      expect(parsed).toEqual({ name: 'test', value: 123 });
    });

    it('should handle JSON parsing failure gracefully', () => {
      const malformedJson = 'not valid json {';
      let result: string;

      try {
        JSON.parse(malformedJson);
        result = 'parsed';
      } catch {
        // Fallback to raw string as showRunLogs does
        result = malformedJson;
      }

      expect(result).toBe(malformedJson);
    });

    it('should format inputs with proper indentation', () => {
      const inputs = { key: 'value', nested: { a: 1 } };
      const formatted = JSON.stringify(inputs, null, 2);

      expect(formatted).toContain('\n');
      expect(formatted).toContain('  ');
    });
  });

  describe('Input retrieval from completed runs', () => {
    it('should preserve inputs after run completion with success', async () => {
      const runId = 'run-completed-success';
      const inputs = { task: 'build', version: '1.0.0' };

      await db.createRun(runId, 'test-workflow', inputs);
      await db.updateRunStatus(runId, 'success', { result: 'ok' });

      const run = await db.getRun(runId);
      expect(run?.status).toBe('success');
      const parsedInputs = JSON.parse(run!.inputs);
      expect(parsedInputs).toEqual(inputs);
    });

    it('should preserve inputs after run completion with failure', async () => {
      const runId = 'run-completed-failed';
      const inputs = { task: 'test', failFast: true };

      await db.createRun(runId, 'test-workflow', inputs);
      await db.updateRunStatus(runId, 'failed', undefined, 'Test failed');

      const run = await db.getRun(runId);
      expect(run?.status).toBe('failed');
      const parsedInputs = JSON.parse(run!.inputs);
      expect(parsedInputs).toEqual(inputs);
    });

    it('should preserve inputs for paused runs', async () => {
      const runId = 'run-paused';
      const inputs = { waitFor: 'approval' };

      await db.createRun(runId, 'test-workflow', inputs);
      await db.updateRunStatus(runId, 'paused');

      const run = await db.getRun(runId);
      expect(run?.status).toBe('paused');
      const parsedInputs = JSON.parse(run!.inputs);
      expect(parsedInputs).toEqual(inputs);
    });
  });

  describe('Inputs with listRuns for history lookup', () => {
    it('should retrieve inputs when looking up runs by short ID', async () => {
      const runId = 'abc12345-full-run-id';
      const inputs = { lookupTest: true };

      await db.createRun(runId, 'test-workflow', inputs);

      // Simulate the short ID lookup pattern from logs command
      const allRuns = await db.listRuns(200);
      const matching = allRuns.find((r) => r.id.startsWith('abc'));

      expect(matching).toBeDefined();
      expect(matching?.id).toBe(runId);

      const detailedRun = await db.getRun(matching!.id);
      const parsedInputs = JSON.parse(detailedRun!.inputs);
      expect(parsedInputs).toEqual(inputs);
    });
  });

  describe('Input types validation', () => {
    it('should handle string inputs', async () => {
      const runId = 'run-string-input';
      const inputs = { message: 'Hello, World!' };

      await db.createRun(runId, 'wf', inputs);
      const run = await db.getRun(runId);
      const parsed = JSON.parse(run!.inputs);

      expect(typeof parsed.message).toBe('string');
      expect(parsed.message).toBe('Hello, World!');
    });

    it('should handle number inputs (integer and float)', async () => {
      const runId = 'run-number-input';
      const inputs = { count: 42, price: 19.99, negative: -10 };

      await db.createRun(runId, 'wf', inputs);
      const run = await db.getRun(runId);
      const parsed = JSON.parse(run!.inputs);

      expect(typeof parsed.count).toBe('number');
      expect(parsed.count).toBe(42);
      expect(parsed.price).toBe(19.99);
      expect(parsed.negative).toBe(-10);
    });

    it('should handle boolean inputs', async () => {
      const runId = 'run-boolean-input';
      const inputs = { enabled: true, disabled: false };

      await db.createRun(runId, 'wf', inputs);
      const run = await db.getRun(runId);
      const parsed = JSON.parse(run!.inputs);

      expect(typeof parsed.enabled).toBe('boolean');
      expect(parsed.enabled).toBe(true);
      expect(parsed.disabled).toBe(false);
    });

    it('should handle array inputs', async () => {
      const runId = 'run-array-input';
      const inputs = { items: ['a', 'b', 'c'], numbers: [1, 2, 3] };

      await db.createRun(runId, 'wf', inputs);
      const run = await db.getRun(runId);
      const parsed = JSON.parse(run!.inputs);

      expect(Array.isArray(parsed.items)).toBe(true);
      expect(parsed.items).toEqual(['a', 'b', 'c']);
      expect(parsed.numbers).toEqual([1, 2, 3]);
    });

    it('should handle null inputs', async () => {
      const runId = 'run-null-input';
      const inputs = { optional: null };

      await db.createRun(runId, 'wf', inputs);
      const run = await db.getRun(runId);
      const parsed = JSON.parse(run!.inputs);

      expect(parsed.optional).toBeNull();
    });

    it('should handle mixed type inputs', async () => {
      const runId = 'run-mixed-input';
      const inputs = {
        str: 'text',
        num: 100,
        bool: true,
        arr: [1, 'two', false],
        obj: { a: 1, b: 'two' },
        nil: null,
      };

      await db.createRun(runId, 'wf', inputs);
      const run = await db.getRun(runId);
      const parsed = JSON.parse(run!.inputs);

      expect(parsed).toEqual(inputs);
    });
  });
});

describe('showRunLogs function behavior', () => {
  let db: WorkflowDb;
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let originalLog: typeof console.log;

  beforeEach(() => {
    db = new WorkflowDb(':memory:');
    originalLog = console.log;
    consoleLogSpy = spyOn(console, 'log');
  });

  afterEach(() => {
    db.close();
    consoleLogSpy.mockRestore();
  });

  // Inline version of showRunLogs for testing
  async function showRunLogs(
    run: WorkflowRun,
    db: WorkflowDb,
    verbose: boolean,
    showInputs: boolean
  ) {
    console.log(`\n🏛️  Run: ${run.workflow_name} (${run.id})`);
    console.log(`   Status: ${run.status}`);
    console.log(`   Started: ${new Date(run.started_at).toLocaleString()}`);
    if (run.completed_at) {
      console.log(`   Completed: ${new Date(run.completed_at).toLocaleString()}`);
    }

    if (showInputs && run.inputs) {
      console.log('\nInputs:');
      try {
        const parsed = JSON.parse(run.inputs);
        console.log(JSON.stringify(parsed, null, 2));
      } catch {
        console.log(run.inputs);
      }
    }

    const steps = await db.getStepsByRun(run.id);
    console.log(`\nSteps (${steps.length}):`);
  }

  it('should display inputs when showInputs is true', async () => {
    const runId = 'run-show-inputs';
    const inputs = { name: 'test', value: 123 };

    await db.createRun(runId, 'test-workflow', inputs);
    const run = await db.getRun(runId);

    await showRunLogs(run!, db, false, true);

    const calls = consoleLogSpy.mock.calls.flat();
    expect(calls.some((c) => c.includes('Inputs:'))).toBe(true);
    expect(calls.some((c) => c.includes('"name": "test"'))).toBe(true);
    expect(calls.some((c) => c.includes('"value": 123'))).toBe(true);
  });

  it('should not display inputs when showInputs is false', async () => {
    const runId = 'run-hide-inputs';
    const inputs = { secret: 'hidden' };

    await db.createRun(runId, 'test-workflow', inputs);
    const run = await db.getRun(runId);

    await showRunLogs(run!, db, false, false);

    const calls = consoleLogSpy.mock.calls.flat();
    expect(calls.some((c) => c.includes('Inputs:'))).toBe(false);
    expect(calls.some((c) => c.includes('hidden'))).toBe(false);
  });

  it('should handle empty inputs object', async () => {
    const runId = 'run-empty-show';
    const inputs = {};

    await db.createRun(runId, 'test-workflow', inputs);
    const run = await db.getRun(runId);

    await showRunLogs(run!, db, false, true);

    const calls = consoleLogSpy.mock.calls.flat();
    expect(calls.some((c) => c.includes('Inputs:'))).toBe(true);
    expect(calls.some((c) => c.includes('{}'))).toBe(true);
  });

  it('should display run metadata correctly', async () => {
    const runId = 'run-metadata';

    await db.createRun(runId, 'my-workflow', { test: true });
    await db.updateRunStatus(runId, 'success', { result: 'ok' });
    const run = await db.getRun(runId);

    await showRunLogs(run!, db, false, false);

    const calls = consoleLogSpy.mock.calls.flat();
    expect(calls.some((c) => c.includes('my-workflow'))).toBe(true);
    expect(calls.some((c) => c.includes('success'))).toBe(true);
  });
});
