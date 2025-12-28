import type { ExpressionContext } from '../../expression/evaluator.ts';
import { ExpressionEvaluator } from '../../expression/evaluator.ts';
import type { HumanStep, SleepStep } from '../../parser/schema.ts';
import type { Logger } from '../../utils/logger.ts';
import { WorkflowSuspendedError, WorkflowWaitingError, type StepResult } from './types.ts';

/**
 * Execute a human input step
 */
export async function executeHumanStep(
    step: HumanStep,
    context: ExpressionContext,
    logger: Logger,
    abortSignal?: AbortSignal
): Promise<StepResult> {
    if (abortSignal?.aborted) {
        throw new Error('Step canceled');
    }
    const message = ExpressionEvaluator.evaluateString(step.message, context);

    // Check if we already have input for this step in context.inputs (from previous suspension)
    const stepInputs = (context.inputs as Record<string, any>)?.[step.id];
    if (stepInputs && stepInputs.__answer !== undefined) {
        logger.log(`  ✓ Received human input: ${stepInputs.__answer}`);
        return {
            status: 'success',
            output: stepInputs.__answer,
        };
    }

    // Not answered yet, suspend
    logger.log(`  ⏳ Suspending for human input: ${message}`);
    throw new WorkflowSuspendedError(message, step.id, step.inputType || 'text');
}

/**
 * Execute a sleep step
 */
export async function executeSleepStep(
    step: SleepStep,
    context: ExpressionContext,
    logger: Logger,
    abortSignal?: AbortSignal
): Promise<StepResult> {
    if (abortSignal?.aborted) {
        throw new Error('Step canceled');
    }

    let durationMs = 0;
    let wakeAt: string | undefined;

    if (step.until) {
        const untilStr = ExpressionEvaluator.evaluateString(step.until, context);
        const untilDate = new Date(untilStr);
        if (isNaN(untilDate.getTime())) {
            throw new Error(`Invalid date format for 'until': ${untilStr}`);
        }
        wakeAt = untilDate.toISOString();
        durationMs = untilDate.getTime() - Date.now();
    } else if (step.duration) {
        const duration = ExpressionEvaluator.evaluateString(step.duration, context);
        // Parse duration (e.g., "10s", "1m", "1h", "50ms")
        const match = duration.match(/^(\d+)([smh]|ms)$/);
        if (!match) {
            throw new Error(`Invalid duration format: ${duration}. Expected e.g. "10s", "1m", "1h", "50ms"`);
        }
        const val = parseInt(match[1], 10);
        const unit = match[2];
        durationMs = val * (unit === 'ms' ? 1 : unit === 's' ? 1000 : unit === 'm' ? 60000 : 3600000);
        wakeAt = new Date(Date.now() + durationMs).toISOString();
    } else {
        throw new Error("Sleep step requires either 'duration' or 'until'");
    }

    if (durationMs <= 0) {
        logger.log('  ✓ Sleep duration already passed or is zero');
        return { status: 'success', output: 'slept' };
    }

    logger.log(`  ⏳ Sleeping until ${wakeAt} (${Math.round(durationMs / 1000)}s remaining)`);

    if (step.durable) {
        throw new WorkflowWaitingError(`Sleeping until ${wakeAt}`, step.id, wakeAt);
    }

    await Bun.sleep(durationMs);
    return { status: 'success', output: 'slept' };
}
