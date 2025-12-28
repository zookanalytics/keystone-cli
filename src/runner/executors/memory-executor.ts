import type { MemoryDb } from '../../db/memory-db.ts';
import type { ExpressionContext } from '../../expression/evaluator.ts';
import { ExpressionEvaluator } from '../../expression/evaluator.ts';
import type { MemoryStep } from '../../parser/schema.ts';
import type { Logger } from '../../utils/logger.ts';
import type { StepExecutorOptions, StepResult } from './types.ts';

/**
 * Execute a memory step (setting/deleting keys in memory)
 */
export async function executeMemoryStep(
    step: MemoryStep,
    context: ExpressionContext,
    _logger: Logger,
    options: StepExecutorOptions
): Promise<StepResult> {
    const memoryDb = options.memoryDb;
    if (!memoryDb) {
        throw new Error('Memory database not initialized');
    }

    const adapterResult = options.getAdapter ? options.getAdapter(step.model || 'local') : null;
    const adapter = adapterResult?.adapter;
    if (!adapter || !adapter.embed) {
        throw new Error(`Model ${step.model} does not support embeddings`);
    }

    switch (step.op) {
        case 'store': {
            const text = ExpressionEvaluator.evaluateString(step.text || '', context);
            if (!text) throw new Error('Text is required for memory store operation');

            const embedding = await adapter.embed(text);
            const metadata = step.metadata || {};
            const id = await memoryDb.store(text, embedding, metadata as Record<string, unknown>);

            return {
                output: { id, text, op: 'store' },
                status: 'success',
            };
        }
        case 'search': {
            const query = ExpressionEvaluator.evaluateString(step.query || '', context);
            if (!query) throw new Error('Query is required for memory search operation');

            const embedding = await adapter.embed(query);
            const limit = step.limit || 5;
            const results = await memoryDb.search(embedding, limit);

            return {
                output: results,
                status: 'success',
            };
        }
        default:
            throw new Error(`Unknown memory operation: ${(step as any).op}`);
    }
}
