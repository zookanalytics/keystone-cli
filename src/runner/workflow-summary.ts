import type { StepExecution } from '../db/workflow-db';
import type { WorkflowEvent } from './events';

/**
 * Format a duration in milliseconds to a human-readable string
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Format a number with comma separators
 */
function formatNumber(num: number): string {
  return num.toLocaleString('en-US');
}

interface StepTiming {
  stepId: string;
  stepType: string;
  durationMs: number;
}

/**
 * Extract timing information from step.end events
 */
export function extractStepTimings(events: WorkflowEvent[]): StepTiming[] {
  const timings: StepTiming[] = [];

  for (const event of events) {
    if (event.type === 'step.end' && event.phase === 'main' && event.durationMs !== undefined) {
      timings.push({
        stepId: event.stepId,
        stepType: event.stepType,
        durationMs: event.durationMs,
      });
    }
  }

  return timings;
}

/**
 * Format timing summary from step events
 */
export function formatTimingSummary(events: WorkflowEvent[]): string | null {
  const timings = extractStepTimings(events);

  if (timings.length === 0) {
    return null;
  }

  const totalMs = timings.reduce((sum, t) => sum + t.durationMs, 0);

  if (totalMs === 0) {
    return null;
  }

  // Sort by duration descending
  const sorted = timings.sort((a, b) => b.durationMs - a.durationMs);

  const lines: string[] = [];
  lines.push(`\n⏱️  Timing Summary (total: ${formatDuration(totalMs)})`);

  for (const timing of sorted) {
    const percentage = Math.round((timing.durationMs / totalMs) * 100);
    lines.push(`  • ${timing.stepId}: ${formatDuration(timing.durationMs)} (${percentage}%)`);
  }

  return lines.join('\n');
}

interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Extract and aggregate token usage from step executions
 */
export function aggregateTokenUsage(steps: StepExecution[]): TokenUsage | null {
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let hasUsage = false;

  for (const step of steps) {
    if (step.usage) {
      try {
        const usage = JSON.parse(step.usage);
        if (usage.prompt_tokens !== undefined) {
          promptTokens += usage.prompt_tokens || 0;
          completionTokens += usage.completion_tokens || 0;
          totalTokens += usage.total_tokens || 0;
          hasUsage = true;
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  return hasUsage ? { promptTokens, completionTokens, totalTokens } : null;
}

/**
 * Estimate cost based on token usage
 * Uses rough estimates for common models (GPT-4o pricing as baseline)
 */
function estimateCost(usage: TokenUsage): string {
  // Rough estimate: $2.50 per 1M input tokens, $10 per 1M output tokens (GPT-4o)
  const inputCost = (usage.promptTokens / 1_000_000) * 2.5;
  const outputCost = (usage.completionTokens / 1_000_000) * 10;
  const total = inputCost + outputCost;

  if (total < 0.01) {
    return '<$0.01';
  }
  return `~$${total.toFixed(2)}`;
}

/**
 * Format token usage summary from step executions
 */
export function formatTokenUsageSummary(steps: StepExecution[]): string | null {
  const usage = aggregateTokenUsage(steps);

  if (!usage) {
    return null;
  }

  const lines: string[] = [];
  lines.push('\n📊 Token Usage');
  lines.push(
    `  • Input: ${formatNumber(usage.promptTokens)} | Output: ${formatNumber(usage.completionTokens)} | Total: ${formatNumber(usage.totalTokens)}`
  );
  lines.push(`  • Estimated cost: ${estimateCost(usage)}`);

  return lines.join('\n');
}
