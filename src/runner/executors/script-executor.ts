import type { ExpressionContext } from '../../expression/evaluator.ts';
import { ExpressionEvaluator } from '../../expression/evaluator.ts';
import type { ScriptStep } from '../../parser/schema.ts';
import type { Logger } from '../../utils/logger.ts';
import type { SafeSandbox } from '../../utils/sandbox.ts';
import { SafeSandbox as DefaultSandbox } from '../../utils/sandbox.ts';
import type { StepResult } from './types.ts';

/**
 * Execute a script step (inline JavaScript)
 */
export async function executeScriptStep(
  step: ScriptStep,
  context: ExpressionContext,
  logger: Logger,
  options: { sandbox?: typeof SafeSandbox; abortSignal?: AbortSignal } = {}
): Promise<StepResult> {
  try {
    const sandbox = options.sandbox || DefaultSandbox;

    // Process template expressions in the script code
    const processedScript = ExpressionEvaluator.evaluateString(step.run, context);

    const result = await sandbox.execute(processedScript, context as any, {
      logger,
      signal: options.abortSignal,
    });

    return {
      status: 'success',
      output: result,
    };
  } catch (error) {
    return {
      status: 'failed',
      output: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
