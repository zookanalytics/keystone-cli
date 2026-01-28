# Implementation Plan: Child Workflow Resume

## Problem Statement

When a parent workflow (e.g., `bmad-epic`) runs a foreach loop that spawns child workflows (e.g., `bmad-story`), and one of those child workflows fails:

1. The child workflow gets its own independent `run_id` stored in the parent step's metadata (`__subRunId`)
2. Running `keystone run parent.yaml --resume` does NOT resume the failed child - it either:
   - Starts a fresh run if parent completed (with aggregated failure)
   - Skips to the next iteration if parent was in progress

**Goal:** Make `--resume` automatically detect and resume failed child workflows as part of resuming the parent.

---

## Current Architecture

### SubworkflowExecutor (`src/runner/executors/subworkflow-executor.ts`)

- Creates child runner via `runnerFactory.create()` (line 58)
- Stores `__subRunId` in parent step metadata (lines 71-75)
- Returns `__subRunId` in step output (line 119)
- **Does NOT** set any parent reference when creating the child run

### ForeachExecutor (`src/runner/executors/foreach-executor.ts`)

- Creates step execution records for each iteration (line 276)
- Calls `executeStepFn` for each item (line 352)
- On resume, hydrates from DB but doesn't check for child workflow runs (lines 230-265)
- No concept of resuming child workflows - only skips successful iterations

### Resume Logic (`src/commands/run.ts` + `src/runner/workflow-runner.ts`)

- `run.ts:65-94`: Queries `getLastRun(workflow.name)` to find resumable run
- `workflow-runner.ts:349-391`: `restoreState()` hydrates step contexts from DB
- **No logic** to traverse step metadata for `__subRunId` and check child run status

---

## Design Decisions

### D1: Resume Execution Model

**Decision:** Resume children lazily in `executeSubWorkflow` when the parent re-invokes them, not pre-emptively in `restoreState()`.

**Rationale:**
- The existing `__subRunId` metadata already links child runs to parent step executions
- Lazy resume naturally handles changing foreach collections (items added/removed between runs)
- Simpler implementation - no need to modify `restoreState()` or add complex child discovery logic
- Consistent with how ForeachExecutor already handles resume (re-evaluates collection, skips successful iterations)

**Flow:**
```
Parent --resume
  └─> restoreState() [no changes needed]
  └─> ForeachExecutor re-evaluates collection (may differ from original)
  └─> For each item needing execution:
        └─> executeSubWorkflow()
              ├─> Check step metadata for existing __subRunId
              ├─> If found and run is failed/paused:
              │     └─> Resume existing child run (with --resume semantics)
              └─> Otherwise: start fresh child run
```

**Benefits:**
- If foreach changes from [1,2,3,4,5] → [1,2,3,4], item 5's failed child is simply never re-invoked
- If foreach adds item 6, it starts fresh naturally
- No need to pre-emptively resume children that might no longer be relevant

### D2: Child Resume Concurrency

**Decision:** Concurrency is automatically preserved - ForeachExecutor handles it.

**Rationale:**
- Since child resume happens lazily via `executeSubWorkflow` during normal ForeachExecutor execution, the original concurrency settings are naturally respected
- ForeachExecutor already uses the step's `concurrency` setting when iterating
- No special handling needed - resume just "plugs in" to the existing parallel execution

### D3: Handling `running` Status in Resumable Children

**Decision:** Include `running` in resumable statuses but emit a prominent warning.

**Rationale:**
- A `running` status typically indicates a crashed/killed process (the normal case for resume)
- However, in rare cases it could indicate a genuinely active process (distributed deployment, zombie process)
- Without a heartbeat mechanism, we cannot distinguish these cases definitively
- Emitting a warning alerts users to potential conflicts while allowing legitimate crash recovery

**Future enhancement:** Add `last_heartbeat` column to detect truly stale runs vs active ones.

---

## Implementation Plan

### Phase 1: Implement Lazy Child Resume in SubworkflowExecutor

The key insight is that child resume should happen lazily when `executeSubWorkflow` is invoked, not pre-emptively in `restoreState()`. This naturally handles changing foreach collections.

#### 1.0 Add `getStepById` Method to WorkflowDb

**File:** `src/db/workflow-db.ts`

Add efficient lookup by step execution UUID (rather than fetching all steps and filtering):

```typescript
private getStepByIdStmt!: Statement;

// In prepareStatements():
this.getStepByIdStmt = this.db.prepare(`
  SELECT * FROM step_executions WHERE id = ?
`);

// New method:
public async getStepById(id: string): Promise<StepExecution | null> {
  return this.withRetry(() => {
    return this.getStepByIdStmt.get(id) as StepExecution | null;
  });
}
```

#### 1.1 Modify SubworkflowExecutor to Resume Existing Runs

**File:** `src/runner/executors/subworkflow-executor.ts`

```typescript
export async function executeSubWorkflow(
  step: WorkflowStep,
  context: ExpressionContext,
  options: {
    runnerFactory: RunnerFactory;
    parentWorkflowDir?: string;
    parentDbPath: string;
    parentLogger: Logger;
    parentMcpManager: MCPManager;
    parentDepth: number;
    parentOptions: any;
    abortSignal?: AbortSignal;
    stepExecutionId?: string;
    parentDb?: any;
    existingSubRunId?: string;  // NEW - from step metadata if resuming
  }
): Promise<StepResult> {
  if (options.abortSignal?.aborted) {
    throw new Error('Sub-workflow aborted');
  }

  const workflowPath = WorkflowRegistry.resolvePath(step.path, options.parentWorkflowDir);
  const workflow = WorkflowParser.loadWorkflow(workflowPath);
  const subWorkflowDir = dirname(workflowPath);

  // Evaluate inputs for the sub-workflow
  const inputs: Record<string, unknown> = {};
  if (step.inputs) {
    for (const [key, value] of Object.entries(step.inputs)) {
      inputs[key] = ExpressionEvaluator.evaluate(value, context);
    }
  }

  // Check if we should resume an existing child run
  let resumeRunId: string | undefined;
  if (options.existingSubRunId && options.parentDb) {
    const existingRun = await options.parentDb.getRun(options.existingSubRunId);
    if (existingRun && ['failed', 'paused', 'running'].includes(existingRun.status)) {
      options.parentLogger.log(`  ↪ Resuming existing child run: ${existingRun.id}`);

      // Warn if status is 'running' (could indicate active process)
      if (existingRun.status === 'running') {
        options.parentLogger.warn(
          `  ⚠️  Child has status 'running'. This usually means the previous process crashed. ` +
          `If another process is actively running this workflow, abort now to avoid conflicts.`
        );
      }

      resumeRunId = existingRun.id;
    }
  }

  // Create runner - either resuming existing or starting fresh
  const subRunner = options.runnerFactory.create(workflow, {
    ...options.parentOptions,
    inputs: resumeRunId ? undefined : inputs,  // Don't override inputs if resuming
    resumeRunId,                               // Resume this run if set
    resumeInputs: resumeRunId ? inputs : undefined,
    dbPath: options.parentDbPath,
    db: options.parentDb,
    logger: options.parentLogger,
    mcpManager: options.parentMcpManager,
    workflowDir: subWorkflowDir,
    depth: options.parentDepth + 1,
    signal: options.abortSignal,
    workflowPath: workflowPath,
  });

  // Track sub-workflow run ID in parent step metadata
  // Note: updateStepMetadata replaces the entire metadata object. Currently __subRunId
  // is the only metadata stored on subworkflow steps, so this is safe. If additional
  // metadata fields are added in the future, this should be changed to merge.
  if (options.stepExecutionId && options.parentDb) {
    try {
      await options.parentDb.updateStepMetadata(options.stepExecutionId, {
        __subRunId: subRunner.runId,
      });
    } catch (error) {
      options.parentLogger.warn(
        `Failed to store sub-workflow run ID in metadata: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  try {
    const output = await subRunner.run();
    // ... rest of existing output handling ...
  } catch (error) {
    return {
      output: null,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
```

#### 1.2 Update WorkflowRunner to Pass Existing SubRunId

**File:** `src/runner/workflow-runner.ts`

When executing a subworkflow step, check if there's an existing `__subRunId` in the step metadata:

```typescript
private async executeSubWorkflow(
  step: WorkflowStep,
  context: ExpressionContext,
  abortSignal?: AbortSignal,
  stepExecutionId?: string
): Promise<StepResult> {
  // Check for existing child run from previous attempt
  let existingSubRunId: string | undefined;
  if (stepExecutionId) {
    const stepExec = await this.db.getStepById(stepExecutionId);
    if (stepExec?.metadata) {
      try {
        const metadata = JSON.parse(stepExec.metadata);
        existingSubRunId = metadata.__subRunId;
      } catch { /* ignore parse errors */ }
    }
  }

  const factory: RunnerFactory = {
    create: (workflow, options) => new WorkflowRunner(workflow, options),
  };

  return executeSubWorkflow(step, context, {
    runnerFactory: factory,
    parentWorkflowDir: this.options.workflowDir,
    parentDbPath: this.db.dbPath,
    parentLogger: this.logger,
    parentMcpManager: this.mcpManager,
    parentDepth: this.depth,
    parentOptions: { ...this.options, executeStep: undefined },
    abortSignal,
    stepExecutionId,
    parentDb: this.db,
    existingSubRunId,  // Pass existing child run ID if found
  });
}
```

#### 1.3 No Changes Required Elsewhere

- **restoreState():** Unchanged - child resume happens lazily via `executeSubWorkflow`
- **ForeachExecutor:** Unchanged - already skips successful iterations via `step_executions` status

---

### Phase 2: Edge Cases

The lazy resume design handles these scenarios naturally without special code:

- **`failFast: false` with partial failures:** Parent resumes, ForeachExecutor re-runs failed iterations, each finds its `__subRunId` and resumes the child instead of starting fresh.
- **Changing foreach collections:** Items removed from the collection are simply never re-invoked (their orphaned child runs are ignored). New items start fresh.
- **Repeated failures:** If a resumed child fails again, it updates its state in the DB. The next resume picks up from the new failure point. Partial progress within the child is preserved.

#### 2.1 Workflow File Modification Detection (Future Enhancement)

**Risk:** If a workflow file is modified between original run and resume, behavior may be unexpected.

**Current approach:** No validation (consistent with existing resume behavior).

**Future enhancement:** Store a content hash in `workflow_runs` and warn on mismatch:
```typescript
workflow_hash TEXT  // SHA256 of workflow file content at run time
```

This is out of scope for initial implementation but noted for future consideration.

---

### Phase 3: Testing

#### 3.1 Integration Tests

**File:** `tests/integration/resume-child-workflows.test.ts`

```typescript
import { WorkflowRunner } from '../../src/runner/workflow-runner';
import { WorkflowDb } from '../../src/db/workflow-db';
import { WorkflowParser } from '../../src/parser/workflow-parser';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('resume child workflows', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'keystone-test-'));
    dbPath = join(tempDir, 'test.db');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should resume failed child workflow when parent is resumed', async () => {
    // Create child workflow that fails on first run, succeeds on second
    const childYaml = `
name: test-child
steps:
  - id: maybe-fail
    type: script
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
      workflowPath: join(tempDir, 'parent.yaml'),
    });

    await expect(runner1.run()).rejects.toThrow();

    const db = new WorkflowDb(dbPath);
    const parentRun = await db.getLastRun('test-parent');
    expect(parentRun?.status).toBe('failed');

    // Resume - should succeed (child is resumed, not started fresh)
    const runner2 = new WorkflowRunner(workflow, {
      dbPath,
      workflowDir: tempDir,
      workflowPath: join(tempDir, 'parent.yaml'),
      resumeRunId: parentRun!.id,
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
  item: { type: number }
steps:
  - id: check
    type: script
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
      workflowPath: join(tempDir, 'parent.yaml'),
    });

    await expect(runner1.run()).rejects.toThrow();

    const db = new WorkflowDb(dbPath);
    const parentRun = await db.getLastRun('test-parent');
    expect(parentRun?.status).toBe('failed');

    // Resume - failed children should be resumed
    const runner2 = new WorkflowRunner(workflow, {
      dbPath,
      workflowDir: tempDir,
      workflowPath: join(tempDir, 'parent.yaml'),
      resumeRunId: parentRun!.id,
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
    type: script
    run: |
      if [ ! -f "${tempDir}/grandchild-ran" ]; then
        touch "${tempDir}/grandchild-ran"
        exit 1
      fi
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
      workflowPath: join(tempDir, 'parent.yaml'),
    });
    await expect(runner1.run()).rejects.toThrow();

    const db = new WorkflowDb(dbPath);
    const parentRun = await db.getLastRun('parent');

    // Resume - should recursively resume grandchild
    const runner2 = new WorkflowRunner(workflow, {
      dbPath,
      workflowDir: tempDir,
      workflowPath: join(tempDir, 'parent.yaml'),
      resumeRunId: parentRun!.id,
    });
    await runner2.run();

    // Verify all levels succeeded
    const parentAfter = await db.getRun(parentRun!.id);
    expect(parentAfter?.status).toBe('success');

    db.close();
  });

  it('should skip already-successful children on resume', async () => {
    let callCount = 0;
    // This test verifies successful children aren't re-executed
    // Implementation uses a counter file to track calls
    const childYaml = `
name: test-child
steps:
  - id: count
    type: script
    run: |
      count=$(cat "${tempDir}/call-count" 2>/dev/null || echo 0)
      echo $((count + 1)) > "${tempDir}/call-count"
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
    type: script
    run: |
      if [ ! -f "${tempDir}/second-attempt" ]; then
        touch "${tempDir}/second-attempt"
        exit 1
      fi
`;
    writeFileSync(join(tempDir, 'parent.yaml'), parentYaml);

    const workflow = WorkflowParser.loadWorkflow(join(tempDir, 'parent.yaml'));

    // First run - child succeeds, then parent fails at fail-step
    const runner1 = new WorkflowRunner(workflow, {
      dbPath,
      workflowDir: tempDir,
      workflowPath: join(tempDir, 'parent.yaml'),
    });
    await expect(runner1.run()).rejects.toThrow();

    // Child was called once
    const countAfterFirst = parseInt(
      require('fs').readFileSync(join(tempDir, 'call-count'), 'utf8')
    );
    expect(countAfterFirst).toBe(1);

    // Resume
    const db = new WorkflowDb(dbPath);
    const parentRun = await db.getLastRun('test-parent');

    const runner2 = new WorkflowRunner(workflow, {
      dbPath,
      workflowDir: tempDir,
      workflowPath: join(tempDir, 'parent.yaml'),
      resumeRunId: parentRun!.id,
    });
    await runner2.run();

    // Child should NOT have been called again (still 1)
    const countAfterResume = parseInt(
      require('fs').readFileSync(join(tempDir, 'call-count'), 'utf8')
    );
    expect(countAfterResume).toBe(1);

    db.close();
  });

  it('should handle changing foreach collection on resume', async () => {
    // Child workflow that fails for item 3 on first run
    const childYaml = `
name: test-child
inputs:
  item: { type: number }
steps:
  - id: check
    type: script
    run: |
      marker="${tempDir}/item-\${{ inputs.item }}-ran"
      if [ ! -f "$marker" ]; then
        touch "$marker"
        # Fail for item 3 on first run
        if [ "\${{ inputs.item }}" = "3" ]; then
          exit 1
        fi
      fi
      echo "processed \${{ inputs.item }}"
`;
    writeFileSync(join(tempDir, 'child.yaml'), childYaml);

    // Use a file to control the foreach collection
    writeFileSync(join(tempDir, 'items.json'), '[1, 2, 3, 4, 5]');

    const parentYaml = `
name: test-parent
steps:
  - id: read-items
    type: script
    run: cat "${tempDir}/items.json"
  - id: process-items
    type: workflow
    path: ./child.yaml
    foreach: \${{ fromJson(steps.read-items.stdout) }}
    inputs:
      item: \${{ item }}
    failFast: false
`;
    writeFileSync(join(tempDir, 'parent.yaml'), parentYaml);

    // First run - item 3 fails
    const workflow = WorkflowParser.loadWorkflow(join(tempDir, 'parent.yaml'));
    const runner1 = new WorkflowRunner(workflow, {
      dbPath,
      workflowDir: tempDir,
      workflowPath: join(tempDir, 'parent.yaml'),
    });
    await expect(runner1.run()).rejects.toThrow();

    const db = new WorkflowDb(dbPath);
    const parentRun = await db.getLastRun('test-parent');

    // Verify item 5 was processed in first run
    expect(require('fs').existsSync(join(tempDir, 'item-5-ran'))).toBe(true);

    // Change the collection - remove item 5, it's no longer needed
    writeFileSync(join(tempDir, 'items.json'), '[1, 2, 3, 4]');

    // Resume - item 3 should be resumed, item 5 is no longer in collection
    const runner2 = new WorkflowRunner(workflow, {
      dbPath,
      workflowDir: tempDir,
      workflowPath: join(tempDir, 'parent.yaml'),
      resumeRunId: parentRun!.id,
    });
    await runner2.run();

    // Parent succeeds with the NEW collection [1,2,3,4]
    const parentRunAfter = await db.getRun(parentRun!.id);
    expect(parentRunAfter?.status).toBe('success');

    db.close();
  });

  it('should resume failed step and run subsequent steps fresh', async () => {
    // Scenario: steps 1,2 succeed, step 3 (subworkflow) fails, step 4 never runs
    // On resume: 1,2 skipped, 3 resumed, 4 runs fresh

    const childYaml = `
name: test-child
steps:
  - id: work
    type: script
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
    type: script
    run: echo "step 1" >> "${tempDir}/execution-order"
  - id: step-2
    type: script
    run: echo "step 2" >> "${tempDir}/execution-order"
  - id: step-3
    type: workflow
    path: ./child.yaml
  - id: step-4
    type: script
    run: echo "step 4" >> "${tempDir}/execution-order"
`;
    writeFileSync(join(tempDir, 'parent.yaml'), parentYaml);
    writeFileSync(join(tempDir, 'execution-order'), '');

    // First run - steps 1,2 succeed, step 3 fails, step 4 never runs
    const workflow = WorkflowParser.loadWorkflow(join(tempDir, 'parent.yaml'));
    const runner1 = new WorkflowRunner(workflow, {
      dbPath,
      workflowDir: tempDir,
      workflowPath: join(tempDir, 'parent.yaml'),
    });
    await expect(runner1.run()).rejects.toThrow();

    const firstRunLog = require('fs').readFileSync(join(tempDir, 'execution-order'), 'utf8');
    expect(firstRunLog.trim()).toBe('step 1\nstep 2');  // Step 4 never ran

    const db = new WorkflowDb(dbPath);
    const parentRun = await db.getLastRun('test-parent');

    // Resume
    const runner2 = new WorkflowRunner(workflow, {
      dbPath,
      workflowDir: tempDir,
      workflowPath: join(tempDir, 'parent.yaml'),
      resumeRunId: parentRun!.id,
    });
    await runner2.run();

    // Verify execution order on resume: only step 4 ran (1,2 skipped, 3's child was resumed)
    const resumeLog = require('fs').readFileSync(join(tempDir, 'execution-order'), 'utf8');
    expect(resumeLog.trim()).toBe('step 1\nstep 2\nstep 4');  // Step 4 now ran

    // Parent completed successfully
    const parentRunAfter = await db.getRun(parentRun!.id);
    expect(parentRunAfter?.status).toBe('success');

    db.close();
  });

});
```

---

### Phase 4: Documentation

#### 4.1 Update CLI Help

**File:** `src/commands/run.ts`

```typescript
.option('--resume', 'Resume the last run (including any failed child workflows)')
```

#### 4.2 Update README/Docs

Document the resume behavior:

```markdown
## Resuming Workflows

The `--resume` flag automatically handles parent-child workflow relationships:

- When resuming a parent workflow, any failed child workflows are resumed first
- Child workflows spawned via `type: workflow` (including in foreach loops) are tracked
- Resume is recursive: grandchild workflows are also resumed as needed
- Once all descendants complete successfully, the parent continues from where it left off
- Successful children are never re-executed on resume

### Example

```bash
# Resume a workflow and all its failed children
keystone run bmad-epic.yaml --resume
```

### Behavior Notes

- **Lazy resume:** Child workflows are resumed when the parent re-invokes them, not pre-emptively
- **Changing collections:** If a foreach evaluates to different items on resume, only relevant items are processed
- **Concurrency preserved:** Children resume with the same concurrency as the original foreach step
- **Same run ID:** Resumed children keep their original run ID (not duplicated)

### ⚠️ Important Warnings

- **Workflow file modifications:** If you modify a workflow file between failure and resume, behavior may be unexpected. The resume uses the current file content.
- **Concurrent execution risk:** Resume does not acquire locks. If two terminals run `keystone run parent.yaml --resume` simultaneously, they may both attempt to resume the same children, corrupting state. Always ensure only one resume is running at a time for a given workflow.
- **'Running' status warning:** If you see a warning about resuming a `running` child, this usually indicates the previous process crashed. However, if another process *is* actively running (e.g., in another terminal), abort immediately to avoid conflicts.
```

---

## Files Modified Summary

| File | Changes |
|------|---------|
| `src/db/workflow-db.ts` | Add `getStepById` method for efficient step lookup by UUID |
| `src/runner/executors/subworkflow-executor.ts` | Check for `existingSubRunId` and resume instead of starting fresh |
| `src/runner/workflow-runner.ts` | Update `executeSubWorkflow` to check step metadata for `__subRunId` and pass it to executor |
| `src/commands/run.ts` | Update help text (minor) |
| `tests/integration/resume-child-workflows.test.ts` | New integration tests |

---

## Rollback Plan

If issues arise:

1. No schema changes - rollback is simply reverting the code changes
2. Can disable child resume logic by removing the `existingSubRunId` check in `executeSubWorkflow`
3. The `__subRunId` metadata is already being written, so no data migration needed

---

## Future Enhancements (Out of Scope)

1. **Workflow hash validation**: Store content hash to detect file modifications
2. **Resume specific child**: Add `--resume-child <run-id>` to resume a specific child without touching the parent
3. **Heartbeat-based stale detection**: Add `last_heartbeat` column to distinguish genuinely crashed `running` workflows from actively executing ones
