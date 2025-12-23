import { randomUUID } from 'node:crypto';
import type { WorkflowDb } from '../db/workflow-db.ts';
import { type ExpressionContext, ExpressionEvaluator } from '../expression/evaluator.ts';
import type { Step } from '../parser/schema.ts';
import { StepStatus, WorkflowStatus } from '../types/status.ts';
import type { Logger } from '../utils/logger.ts';
import { WorkflowSuspendedError } from './step-executor.ts';
import type { ForeachStepContext, StepContext } from './workflow-runner.ts';

export type ExecuteStepCallback = (
  step: Step,
  context: ExpressionContext,
  stepExecId: string
) => Promise<StepContext>;

export class ForeachExecutor {
  private static readonly MEMORY_WARNING_THRESHOLD = 1000;
  private hasWarnedMemory = false;

  constructor(
    private db: WorkflowDb,
    private logger: Logger,
    private executeStepFn: ExecuteStepCallback
  ) {}

  /**
   * Aggregate outputs from multiple iterations of a foreach step
   */
  public static aggregateOutputs(outputs: unknown[]): Record<string, unknown> {
    const parentOutputs: Record<string, unknown> = {};

    if (outputs.length === 0) return parentOutputs;

    // We can only aggregate objects, and we assume all outputs have similar shape
    const firstOutput = outputs[0];
    if (typeof firstOutput !== 'object' || firstOutput === null) {
      return parentOutputs;
    }

    // Collect all keys from all outputs
    const keys = new Set<string>();
    for (const output of outputs) {
      if (typeof output === 'object' && output !== null) {
        for (const key of Object.keys(output)) {
          keys.add(key);
        }
      }
    }

    // For each key, create an array of values
    for (const key of keys) {
      parentOutputs[key] = outputs.map((output) => {
        if (typeof output === 'object' && output !== null) {
          return (output as Record<string, unknown>)[key];
        }
        return undefined;
      });
    }

    return parentOutputs;
  }

  /**
   * Execute a step with foreach logic
   */
  async execute(
    step: Step,
    baseContext: ExpressionContext,
    runId: string,
    existingContext?: ForeachStepContext
  ): Promise<ForeachStepContext> {
    if (!step.foreach) {
      throw new Error('Step is not a foreach step');
    }

    const items = ExpressionEvaluator.evaluate(step.foreach, baseContext);
    if (!Array.isArray(items)) {
      throw new Error(`foreach expression must evaluate to an array: ${step.foreach}`);
    }

    this.logger.log(`  ⤷ Executing step ${step.id} for ${items.length} items`);

    if (items.length > ForeachExecutor.MEMORY_WARNING_THRESHOLD && !this.hasWarnedMemory) {
      this.logger.warn(
        `  ⚠️  Warning: Large foreach loop detected (${items.length} items). This may consume significant memory and lead to instability.`
      );
      this.hasWarnedMemory = true;
    }

    // Evaluate concurrency
    let concurrencyLimit = items.length;
    if (step.concurrency !== undefined) {
      if (typeof step.concurrency === 'string') {
        concurrencyLimit = Number(ExpressionEvaluator.evaluate(step.concurrency, baseContext));
        if (!Number.isInteger(concurrencyLimit) || concurrencyLimit <= 0) {
          throw new Error(
            `concurrency must evaluate to a positive integer, got: ${concurrencyLimit}`
          );
        }
      } else {
        concurrencyLimit = step.concurrency;
      }
    }

    // Create parent step record in DB
    const parentStepExecId = randomUUID();
    await this.db.createStep(parentStepExecId, runId, step.id);
    await this.db.startStep(parentStepExecId);

    // Persist the foreach items
    await this.db.completeStep(parentStepExecId, StepStatus.PENDING, { __foreachItems: items });

    try {
      // Initialize results array
      const itemResults: StepContext[] = existingContext?.items || new Array(items.length);

      // Ensure array is correct length
      if (itemResults.length !== items.length) {
        itemResults.length = items.length;
      }

      // Worker pool implementation
      let currentIndex = 0;
      let aborted = false;
      const workers = new Array(Math.min(concurrencyLimit, items.length))
        .fill(null)
        .map(async () => {
          while (currentIndex < items.length && !aborted) {
            const i = currentIndex++; // Capture index atomically
            const item = items[i];

            // Skip if already successful or skipped
            if (
              itemResults[i] &&
              (itemResults[i].status === StepStatus.SUCCESS ||
                itemResults[i].status === StepStatus.SKIPPED)
            ) {
              continue;
            }

            // Build item-specific context
            const itemContext = {
              ...baseContext,
              item,
              index: i,
            };

            // Check DB again for robustness
            const existingExec = await this.db.getStepByIteration(runId, step.id, i);
            if (
              existingExec &&
              (existingExec.status === StepStatus.SUCCESS ||
                existingExec.status === StepStatus.SKIPPED)
            ) {
              let output: unknown = null;
              try {
                output = existingExec.output ? JSON.parse(existingExec.output) : null;
              } catch (error) {
                this.logger.warn(
                  `Failed to parse output for step ${step.id} iteration ${i}: ${error}`
                );
                output = { error: 'Failed to parse output' };
              }
              itemResults[i] = {
                output,
                outputs:
                  typeof output === 'object' && output !== null && !Array.isArray(output)
                    ? (output as Record<string, unknown>)
                    : {},
                status: existingExec.status as
                  | typeof StepStatus.SUCCESS
                  | typeof StepStatus.SKIPPED,
              } as StepContext;
              continue;
            }

            const stepExecId = randomUUID();
            await this.db.createStep(stepExecId, runId, step.id, i);

            // Execute and store result
            try {
              this.logger.log(`  ⤷ [${i + 1}/${items.length}] Executing iteration...`);
              itemResults[i] = await this.executeStepFn(step, itemContext, stepExecId);
              if (itemResults[i].status === StepStatus.FAILED) {
                aborted = true;
              }
            } catch (error) {
              aborted = true;
              throw error;
            }
          }
        });

      await Promise.all(workers);

      // Aggregate results
      const outputs = itemResults.map((r) => r.output);
      const allSuccess = itemResults.every((r) => r.status === StepStatus.SUCCESS);
      const anySuspended = itemResults.some((r) => r.status === StepStatus.SUSPENDED);

      // Aggregate usage
      const aggregatedUsage = itemResults.reduce(
        (acc, r) => {
          if (r.usage) {
            acc.prompt_tokens += r.usage.prompt_tokens;
            acc.completion_tokens += r.usage.completion_tokens;
            acc.total_tokens += r.usage.total_tokens;
          }
          return acc;
        },
        { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      );

      // Map child properties
      const mappedOutputs = ForeachExecutor.aggregateOutputs(outputs);

      // Determine final status
      let finalStatus: (typeof StepStatus)[keyof typeof StepStatus] = StepStatus.FAILED;
      if (allSuccess) {
        finalStatus = StepStatus.SUCCESS;
      } else if (anySuspended) {
        finalStatus = StepStatus.SUSPENDED;
      }

      const aggregatedContext: ForeachStepContext = {
        output: outputs,
        outputs: mappedOutputs,
        status: finalStatus,
        items: itemResults,
        usage: aggregatedUsage,
      };

      // Update parent step record
      await this.db.completeStep(
        parentStepExecId,
        finalStatus,
        aggregatedContext,
        finalStatus === StepStatus.FAILED ? 'One or more iterations failed' : undefined
      );

      if (finalStatus === StepStatus.SUSPENDED) {
        const suspendedItem = itemResults.find((r) => r.status === StepStatus.SUSPENDED);
        throw new WorkflowSuspendedError(
          suspendedItem?.error || 'Iteration suspended',
          step.id,
          'text'
        );
      }

      if (finalStatus === StepStatus.FAILED) {
        throw new Error(`Step ${step.id} failed: one or more iterations failed`);
      }

      return aggregatedContext;
    } catch (error) {
      if (error instanceof WorkflowSuspendedError) {
        throw error;
      }
      // Mark parent step as failed
      const errorMsg = error instanceof Error ? error.message : String(error);
      await this.db.completeStep(parentStepExecId, StepStatus.FAILED, null, errorMsg);
      throw error;
    }
  }
}
