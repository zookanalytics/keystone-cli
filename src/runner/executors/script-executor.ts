import type { ExpressionContext } from '../../expression/evaluator.ts';
import { ExpressionEvaluator } from '../../expression/evaluator.ts';
import type { ScriptStep } from '../../parser/schema.ts';
import type { Logger } from '../../utils/logger.ts';
import type { StepResult } from './types.ts';

/**
 * Execute a script step (inline JavaScript)
 */
export async function executeScriptStep(
    step: ScriptStep,
    context: ExpressionContext,
    _logger: Logger
): Promise<StepResult> {
    const code = step.run;
    const scriptContext = {
        ...context,
        // Add some useful utilities for scripts
        fetch,
        URL,
        URLSearchParams,
        JSON,
        Math,
        Date,
    };

    try {
        // We use a AsyncFunction constructor to allow await in scripts
        // and provide safe access to the context
        const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
        const fn = new AsyncFunction(...Object.keys(scriptContext), `return (async () => { ${code} })();`);

        const result = await fn(...Object.values(scriptContext));

        return {
            status: 'success',
            output: result,
        };
    } catch (error) {
        return {
            status: 'failed',
            output: null,
            error: `Script execution failed: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}
