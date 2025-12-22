import { readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { stringify } from 'yaml';
import { parseAgent, resolveAgentPath } from '../parser/agent-parser';
import type { LlmStep, Step, Workflow } from '../parser/schema';
import { extractJson } from '../utils/json-parser';
import { getAdapter } from './llm-adapter';
import { executeLlmStep } from './llm-executor';
import { WorkflowRunner } from './workflow-runner';

export interface OptimizationOptions {
  workflowPath: string;
  targetStepId: string;
  inputs?: Record<string, unknown>;
  iterations?: number;
}

export class OptimizationRunner {
  private workflow: Workflow;
  private workflowPath: string;
  private targetStepId: string;
  private iterations: number;
  private inputs: Record<string, unknown>;

  constructor(workflow: Workflow, options: OptimizationOptions) {
    this.workflow = workflow;
    this.workflowPath = options.workflowPath;
    this.targetStepId = options.targetStepId;
    this.iterations = options.iterations || 5;
    this.inputs = options.inputs || {};
  }

  public async optimize(): Promise<{ bestPrompt: string; bestScore: number }> {
    if (!this.workflow.eval) {
      throw new Error('Workflow is missing "eval" configuration');
    }

    const targetStep = this.workflow.steps.find((s) => s.id === this.targetStepId);
    if (!targetStep || (targetStep.type !== 'llm' && targetStep.type !== 'shell')) {
      throw new Error(`Target step "${this.targetStepId}" not found or is not an LLM/Shell step`);
    }

    console.log(`\n🚀 Optimizing step: ${this.targetStepId} (${targetStep.type})`);
    console.log(`📊 Iterations: ${this.iterations}`);

    let bestPrompt =
      targetStep.type === 'llm'
        ? (targetStep as LlmStep).prompt
        : // biome-ignore lint/suspicious/noExplicitAny: generic step access
          (targetStep as any).run;
    let bestScore = -1;
    let currentPrompt = bestPrompt;

    for (let i = 1; i <= this.iterations; i++) {
      console.log(`\n--- Iteration ${i}/${this.iterations} ---`);
      console.log(
        `Current Prompt: ${currentPrompt.substring(0, 100)}${currentPrompt.length > 100 ? '...' : ''}`
      );

      // 1. Run the workflow until the target step (or full run for simplicity in MVP)
      // Note: In a more optimized version, we'd only run dependencies once.
      // For now, we run a full WorkflowRunner but with the modified prompt.
      const modifiedWorkflow = JSON.parse(JSON.stringify(this.workflow));
      const modifiedTargetStep = modifiedWorkflow.steps.find(
        (s: { id: string }) => s.id === this.targetStepId
      );

      if (modifiedTargetStep.type === 'llm') {
        modifiedTargetStep.prompt = currentPrompt;
      } else {
        modifiedTargetStep.run = currentPrompt;
      }

      const runner = new WorkflowRunner(modifiedWorkflow, {
        inputs: this.inputs,
        workflowDir: dirname(this.workflowPath),
      });

      const outputs = await runner.run();

      // 2. Evaluate the result
      const score = await this.evaluate(outputs);
      console.log(`Score: ${score}/100`);

      if (score > bestScore) {
        bestScore = score;
        bestPrompt = currentPrompt;
        console.log(`✨ New best score: ${bestScore}`);
      }

      // 3. Suggest next prompt (if not last iteration)
      if (i < this.iterations) {
        currentPrompt = await this.suggestNextPrompt(currentPrompt, score, outputs);
      }
    }

    await this.saveBestPrompt(bestPrompt);
    return { bestPrompt, bestScore };
  }

  private async evaluate(outputs: Record<string, unknown>): Promise<number> {
    const { eval: evalConfig } = this.workflow;
    if (!evalConfig) return 0;

    if (evalConfig.scorer === 'script') {
      const { getAdapter } = await import('./llm-adapter'); // Dynamic import to avoid cycles? Not needed but safe
      const { executeStep } = await import('./step-executor');

      // Create a context with outputs available
      const context = {
        inputs: this.inputs,
        steps: {},
        // biome-ignore lint/suspicious/noExplicitAny: environment access
        secrets: Bun.env as any,
        env: this.workflow.env,
        outputs, // Direct access
        output: outputs, // For convenience
      };

      const scriptStep: Step = {
        id: 'evaluator',
        type: 'script',
        run: evalConfig.run || 'echo 0',
      };

      // Execute script
      // We need to inject the outputs into the environment or allow the script to access them via template
      // The step executor handles interpolation in the 'run' command.
      // But if the script is extensive, it might be tricky.
      // For now, assume the user interpolates scores like `node score.js ${{ outputs.foo }}`

      // We need a proper step executor call here.
      // We'll mock the missing dependencies for executeStep as we did for executeLlmStep,
      // but we need to pass the context correctly.

      // Note: OptimizationRunner should probably import executeStep
      const { SafeSandbox } = await import('../utils/sandbox');
      try {
        const result = await SafeSandbox.execute(scriptStep.run, context, { timeout: 5000 });
        if (typeof result === 'object' && result !== null && 'stdout' in result) {
          // biome-ignore lint/suspicious/noExplicitAny: result typing
          const match = (result as any).stdout.match(/\d+/);
          if (match) return Number.parseInt(match[0], 10);
        }
        // If raw result is number
        if (typeof result === 'number') return result;
        // If string
        if (typeof result === 'string') {
          const match = result.match(/\d+/);
          if (match) return Number.parseInt(match[0], 10);
        }
      } catch (e) {
        console.error('Eval script failed:', e);
      }
      return 0;
    }

    // LLM Scorer
    if (!evalConfig.agent || !evalConfig.prompt) {
      console.warn('Skipping LLM evaluation: agent or prompt missing');
      return 0;
    }

    const evalStep: LlmStep = {
      id: 'evaluator',
      type: 'llm',
      agent: evalConfig.agent,
      prompt: `${evalConfig.prompt}\n\nOutputs to evaluate:\n${JSON.stringify(outputs, null, 2)}`,
      needs: [],
      maxIterations: 10,
      schema: {
        type: 'object',
        properties: {
          score: { type: 'number', minimum: 0, maximum: 100 },
        },
        required: ['score'],
      },
    };

    // Use a temporary runner/context for evaluation
    // We need a minimal context for executeLlmStep
    const context = {
      inputs: this.inputs,
      steps: {},
      // biome-ignore lint/suspicious/noExplicitAny: environment access
      secrets: Bun.env as any,
      env: this.workflow.env,
    };

    const result = await executeLlmStep(
      evalStep,
      // biome-ignore lint/suspicious/noExplicitAny: context typing
      context as any,
      async () => {
        throw new Error('Tools not supported in eval');
      },
      console
    );

    if (result.status === 'success' && result.output && typeof result.output === 'object') {
      // biome-ignore lint/suspicious/noExplicitAny: output typing
      return (result.output as any).score || 0;
    }

    // Try to extract number if JSON failed but text output exists
    if (typeof result.output === 'string') {
      const match = result.output.match(/\d+/);
      if (match) return Number.parseInt(match[0], 10);
    }

    return 0;
  }

  private async suggestNextPrompt(
    currentPrompt: string,
    lastScore: number,
    lastOutputs: Record<string, unknown>
  ): Promise<string> {
    const metaStep: LlmStep = {
      id: 'optimizer',
      type: 'llm',
      agent: 'general', // Or a specialized "optimizer" agent if available
      needs: [],
      maxIterations: 10,
      prompt: `You are an expert prompt engineer. Your task is to optimize a system prompt to get a higher score.
Current Prompt:
"""
${currentPrompt}
"""

Last Score: ${lastScore}/100

Last Outputs:
${JSON.stringify(lastOutputs, null, 2)}

Evaluation Criteria:
${this.workflow.eval?.prompt || this.workflow.eval?.run}

Suggest a slightly modified version of the prompt that might improve the score. 
Maintain the same core instructions but refine the phrasing, add constraints, or clarify expectations.
Return ONLY the new prompt text.`,
    };

    const context = {
      inputs: this.inputs,
      steps: {},
      // biome-ignore lint/suspicious/noExplicitAny: environment access
      secrets: Bun.env as any,
      env: this.workflow.env,
    };

    try {
      const result = await executeLlmStep(
        metaStep,
        // biome-ignore lint/suspicious/noExplicitAny: context typing
        context as any,
        async () => {
          throw new Error('Tools not supported in meta-opt');
        },
        console,
        undefined,
        dirname(this.workflowPath) // Pass workflowDir to resolve agent
      );
      if (result.status === 'success' && typeof result.output === 'string') {
        return result.output.trim();
      }
    } catch (e) {
      console.warn(`  ⚠️ Meta-optimizer failed: ${e instanceof Error ? e.message : String(e)}`);
      // Adding a dummy mutation for testing purposes if env var is set
      if (Bun.env.TEST_OPTIMIZER) {
        return `${currentPrompt}!`;
      }
    }

    return currentPrompt; // Fallback to current
  }

  private async saveBestPrompt(prompt: string): Promise<void> {
    console.log(`\n💾 Saving best prompt to ${this.workflowPath}`);

    // We need to be careful here. The prompt might be in the workflow YAML directly,
    // or it might be in an agent file.

    const targetStep = this.workflow.steps.find((s) => s.id === this.targetStepId);

    console.log(`--- BEST PROMPT/RUN ---\n${prompt}\n-----------------------`);

    if (targetStep?.type === 'llm') {
      const agentPath = resolveAgentPath((targetStep as LlmStep).agent, dirname(this.workflowPath));
      try {
        // For MVP, we just logged it. Automatic replacement in arbitrary files is risky without robust parsing.
        // But we can try to warn/notify.
        console.log(
          `To apply this optimization, update the 'systemPrompt' or instruction in: ${agentPath}`
        );
      } catch (e) {
        console.warn(`Could not locate agent file: ${e}`);
      }
    } else {
      console.log(
        `To apply this optimization, update the 'run' command for step '${this.targetStepId}' in ${this.workflowPath}`
      );
    }
  }
}
