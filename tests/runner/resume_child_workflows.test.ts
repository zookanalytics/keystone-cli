import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowDb } from '../../src/db/workflow-db';
import { WorkflowParser } from '../../src/parser/workflow-parser';
import { WorkflowRunner } from '../../src/runner/workflow-runner';
import { SilentLogger } from '../../src/utils/logger';

describe('resume child workflows', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'keystone-test-'));
    dbPath = join(tempDir, 'test.db');
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should resume failed child workflow when parent is resumed', async () => {
    // Create child workflow that fails on first run, succeeds on second
    const childYaml = `
name: test-child
steps:
  - id: maybe-fail
    type: shell
    run: |
      if [ ! -f "${tempDir}/child-ran-once" ]; then
        touch "${tempDir}/child-ran-once"
        exit 1
      fi
      echo "success"
`;
    writeFileSync(join(tempDir, 'child.yaml'), childYaml);

    // Create parent workflow that calls child
    const parentYaml = `
name: test-parent
steps:
  - id: call-child
    type: workflow
    path: ./child.yaml
`;
    writeFileSync(join(tempDir, 'parent.yaml'), parentYaml);

    // First run - should fail
    const workflow = WorkflowParser.loadWorkflow(join(tempDir, 'parent.yaml'));
    const runner1 = new WorkflowRunner(workflow, {
      dbPath,
      workflowDir: tempDir,
      logger: new SilentLogger(),
      preventExit: true,
    });

    await expect(runner1.run()).rejects.toThrow();

    const db = new WorkflowDb(dbPath);
    const parentRun = await db.getLastRun('test-parent');
    expect(parentRun?.status).toBe('failed');

    // Resume - should succeed (child is resumed, not started fresh)
    const runner2 = new WorkflowRunner(workflow, {
      dbPath,
      workflowDir: tempDir,
      logger: new SilentLogger(),
      resumeRunId: parentRun!.id,
      preventExit: true,
    });

    await runner2.run();

    // Verify parent succeeded (implies child was resumed successfully)
    const parentRunAfter = await db.getRun(parentRun!.id);
    expect(parentRunAfter?.status).toBe('success');

    db.close();
  });

  it('should resume multiple failed children in foreach', async () => {
    // Create child workflow that fails for specific items
    const childYaml = `
name: test-child
inputs:
  item:
    type: number
steps:
  - id: check
    type: shell
    run: |
      marker="${tempDir}/item-\${{ inputs.item }}-ran"
      if [ ! -f "$marker" ]; then
        touch "$marker"
        # Fail for items 2 and 4 on first run
        if [ "\${{ inputs.item }}" = "2" ] || [ "\${{ inputs.item }}" = "4" ]; then
          exit 1
        fi
      fi
      echo "success"
`;
    writeFileSync(join(tempDir, 'child.yaml'), childYaml);

    const parentYaml = `
name: test-parent
steps:
  - id: process-items
    type: workflow
    path: ./child.yaml
    foreach: \${{ [1, 2, 3, 4, 5] }}
    inputs:
      item: \${{ item }}
    failFast: false
`;
    writeFileSync(join(tempDir, 'parent.yaml'), parentYaml);

    // First run
    const workflow = WorkflowParser.loadWorkflow(join(tempDir, 'parent.yaml'));
    const runner1 = new WorkflowRunner(workflow, {
      dbPath,
      workflowDir: tempDir,
      logger: new SilentLogger(),
      preventExit: true,
    });

    await expect(runner1.run()).rejects.toThrow();

    const db = new WorkflowDb(dbPath);
    const parentRun = await db.getLastRun('test-parent');
    expect(parentRun?.status).toBe('failed');

    // Resume - failed children should be resumed
    const runner2 = new WorkflowRunner(workflow, {
      dbPath,
      workflowDir: tempDir,
      logger: new SilentLogger(),
      resumeRunId: parentRun!.id,
      preventExit: true,
    });

    await runner2.run();

    // Parent succeeds (implies all children now successful)
    const parentRunAfter = await db.getRun(parentRun!.id);
    expect(parentRunAfter?.status).toBe('success');

    db.close();
  });

  it('should handle deeply nested child workflows (grandchildren)', async () => {
    // Grandchild
    const grandchildYaml = `
name: grandchild
steps:
  - id: work
    type: shell
    run: |
      if [ ! -f "${tempDir}/grandchild-ran" ]; then
        touch "${tempDir}/grandchild-ran"
        exit 1
      fi
      echo "grandchild success"
`;
    writeFileSync(join(tempDir, 'grandchild.yaml'), grandchildYaml);

    // Child calls grandchild
    const childYaml = `
name: child
steps:
  - id: call-grandchild
    type: workflow
    path: ./grandchild.yaml
`;
    writeFileSync(join(tempDir, 'child.yaml'), childYaml);

    // Parent calls child
    const parentYaml = `
name: parent
steps:
  - id: call-child
    type: workflow
    path: ./child.yaml
`;
    writeFileSync(join(tempDir, 'parent.yaml'), parentYaml);

    const workflow = WorkflowParser.loadWorkflow(join(tempDir, 'parent.yaml'));

    // First run - grandchild fails
    const runner1 = new WorkflowRunner(workflow, {
      dbPath,
      workflowDir: tempDir,
      logger: new SilentLogger(),
      preventExit: true,
    });
    await expect(runner1.run()).rejects.toThrow();

    const db = new WorkflowDb(dbPath);
    const parentRun = await db.getLastRun('parent');

    // Resume - should recursively resume grandchild
    const runner2 = new WorkflowRunner(workflow, {
      dbPath,
      workflowDir: tempDir,
      logger: new SilentLogger(),
      resumeRunId: parentRun!.id,
      preventExit: true,
    });
    await runner2.run();

    // Verify all levels succeeded
    const parentAfter = await db.getRun(parentRun!.id);
    expect(parentAfter?.status).toBe('success');

    db.close();
  });

  it('should skip already-successful children on resume', async () => {
    // This test verifies successful children aren't re-executed
    // Implementation uses a counter file to track calls
    const childYaml = `
name: test-child
steps:
  - id: count
    type: shell
    run: |
      count=$(cat "${tempDir}/call-count" 2>/dev/null || echo 0)
      echo $((count + 1)) > "${tempDir}/call-count"
      echo "counted"
`;
    writeFileSync(join(tempDir, 'child.yaml'), childYaml);
    writeFileSync(join(tempDir, 'call-count'), '0');

    const parentYaml = `
name: test-parent
steps:
  - id: first
    type: workflow
    path: ./child.yaml
  - id: fail-step
    type: shell
    run: |
      if [ ! -f "${tempDir}/second-attempt" ]; then
        touch "${tempDir}/second-attempt"
        exit 1
      fi
      echo "success"
`;
    writeFileSync(join(tempDir, 'parent.yaml'), parentYaml);

    const workflow = WorkflowParser.loadWorkflow(join(tempDir, 'parent.yaml'));

    // First run - child succeeds, then parent fails at fail-step
    const runner1 = new WorkflowRunner(workflow, {
      dbPath,
      workflowDir: tempDir,
      logger: new SilentLogger(),
      preventExit: true,
    });
    await expect(runner1.run()).rejects.toThrow();

    // Child was called once
    const countAfterFirst = parseInt(
      require('fs').readFileSync(join(tempDir, 'call-count'), 'utf8').trim()
    );
    expect(countAfterFirst).toBe(1);

    // Resume
    const db = new WorkflowDb(dbPath);
    const parentRun = await db.getLastRun('test-parent');

    const runner2 = new WorkflowRunner(workflow, {
      dbPath,
      workflowDir: tempDir,
      logger: new SilentLogger(),
      resumeRunId: parentRun!.id,
      preventExit: true,
    });
    await runner2.run();

    // Child should NOT have been called again (still 1)
    const countAfterResume = parseInt(
      require('fs').readFileSync(join(tempDir, 'call-count'), 'utf8').trim()
    );
    expect(countAfterResume).toBe(1);

    db.close();
  });

  it('should resume failed step and run subsequent steps fresh', async () => {
    // Scenario: steps 1,2 succeed, step 3 (subworkflow) fails, step 4 never runs
    // On resume: 1,2 skipped, 3 resumed, 4 runs fresh

    const childYaml = `
name: test-child
steps:
  - id: work
    type: shell
    run: |
      marker="${tempDir}/child-ran"
      if [ ! -f "$marker" ]; then
        touch "$marker"
        exit 1  # Fail first time
      fi
      echo "child succeeded"
`;
    writeFileSync(join(tempDir, 'child.yaml'), childYaml);

    const parentYaml = `
name: test-parent
steps:
  - id: step-1
    type: shell
    run: echo "step 1" >> "${tempDir}/execution-order"
  - id: step-2
    type: shell
    needs: [step-1]
    run: echo "step 2" >> "${tempDir}/execution-order"
  - id: step-3
    type: workflow
    needs: [step-2]
    path: ./child.yaml
  - id: step-4
    type: shell
    needs: [step-3]
    run: echo "step 4" >> "${tempDir}/execution-order"
`;
    writeFileSync(join(tempDir, 'parent.yaml'), parentYaml);
    writeFileSync(join(tempDir, 'execution-order'), '');

    // First run - steps 1,2 succeed, step 3 fails, step 4 never runs
    const workflow = WorkflowParser.loadWorkflow(join(tempDir, 'parent.yaml'));
    const runner1 = new WorkflowRunner(workflow, {
      dbPath,
      workflowDir: tempDir,
      logger: new SilentLogger(),
      preventExit: true,
    });
    await expect(runner1.run()).rejects.toThrow();

    const firstRunLog = require('fs').readFileSync(join(tempDir, 'execution-order'), 'utf8');
    expect(firstRunLog.trim()).toBe('step 1\nstep 2'); // Step 4 never ran

    const db = new WorkflowDb(dbPath);
    const parentRun = await db.getLastRun('test-parent');

    // Resume
    const runner2 = new WorkflowRunner(workflow, {
      dbPath,
      workflowDir: tempDir,
      logger: new SilentLogger(),
      resumeRunId: parentRun!.id,
      preventExit: true,
    });
    await runner2.run();

    // Verify execution order on resume: only step 4 ran (1,2 skipped, 3's child was resumed)
    const resumeLog = require('fs').readFileSync(join(tempDir, 'execution-order'), 'utf8');
    expect(resumeLog.trim()).toBe('step 1\nstep 2\nstep 4'); // Step 4 now ran

    // Parent completed successfully
    const parentRunAfter = await db.getRun(parentRun!.id);
    expect(parentRunAfter?.status).toBe('success');

    db.close();
  });
});
