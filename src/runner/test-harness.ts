import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { type ExpressionContext, ExpressionEvaluator } from '../expression/evaluator';
import type { Step, Workflow } from '../parser/schema';
import { ConsoleLogger, type Logger } from '../utils/logger';
import type { LLMAdapter, LLMMessage, LLMResponse } from './llm-adapter';
import { type StepExecutorOptions, type StepResult, executeStep } from './step-executor';
import { WorkflowRunner } from './workflow-runner';

export interface TestFixture {
  inputs?: Record<string, unknown>;
  env?: Record<string, string>;
  secrets?: Record<string, string>;
  mocks?: Array<{
    step?: string;
    type?: string;
    prompt?: string;
    response: unknown;
  }>;
}

export interface TestSnapshot {
  steps: Record<
    string,
    {
      status: string;
      output: unknown;
      error?: string;
    }
  >;
  outputs: Record<string, unknown>;
}

export class TestHarness {
  private stepResults: Map<string, { status: string; output: unknown; error?: string }> = new Map();
  private mockResponses: Map<string, unknown> = new Map();
  private llmMocks: Array<{ prompt: string; response: unknown }> = [];

  constructor(
    private workflow: Workflow,
    private fixture: TestFixture = {}
  ) {
    if (fixture.mocks) {
      for (const mock of fixture.mocks) {
        if (mock.step) {
          this.mockResponses.set(mock.step, mock.response);
        } else if (mock.prompt) {
          this.llmMocks.push({ prompt: mock.prompt, response: mock.response });
        }
      }
    }
  }

  async run(): Promise<TestSnapshot> {
    // Capture original environment for cleanup
    const originalEnv = { ...process.env };
    const addedKeys: string[] = [];

    const runner = new WorkflowRunner(this.workflow, {
      inputs: this.fixture.inputs,
      secrets: this.fixture.secrets,
      executeStep: this.mockExecuteStep.bind(this),
      getAdapter: this.getMockAdapter.bind(this),
      // Use memory DB for tests
      dbPath: ':memory:',
    });

    try {
      // Inject env
      if (this.fixture.env) {
        for (const [key, value] of Object.entries(this.fixture.env)) {
          if (!(key in originalEnv)) {
            addedKeys.push(key);
          }
          process.env[key] = value;
        }
      }

      const outputs = await runner.run();

      return {
        steps: Object.fromEntries(this.stepResults.entries()),
        outputs,
      };
    } finally {
      // Restore original environment
      for (const key of addedKeys) {
        delete process.env[key];
      }
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value !== undefined) {
          process.env[key] = value;
        }
      }
    }
  }

  private async mockExecuteStep(
    step: Step,
    context: ExpressionContext,
    logger: Logger,
    options: StepExecutorOptions
  ): Promise<StepResult> {
    const mockResponse = this.mockResponses.get(step.id);
    if (mockResponse !== undefined) {
      const result: StepResult = {
        output: mockResponse,
        status: 'success',
      };
      this.stepResults.set(step.id, {
        status: result.status,
        output: result.output,
        error: result.error,
      });
      return result;
    }

    // Default to real execution but capture snapshot
    const result = await executeStep(step, context, logger, {
      ...options,
      executeStep: this.mockExecuteStep.bind(this),
      getAdapter: this.getMockAdapter.bind(this),
    });

    this.stepResults.set(step.id, {
      status: result.status,
      output: result.output,
      error: result.error,
    });

    return result;
  }

  private getMockAdapter(model: string): { adapter: LLMAdapter; resolvedModel: string } {
    return {
      resolvedModel: model,
      adapter: {
        chat: async (messages: LLMMessage[]) => {
          const userMessage = messages.find((m) => m.role === 'user')?.content || '';

          for (const mock of this.llmMocks) {
            if (userMessage.includes(mock.prompt)) {
              return {
                message: {
                  role: 'assistant',
                  content:
                    typeof mock.response === 'string'
                      ? mock.response
                      : JSON.stringify(mock.response),
                },
              };
            }
          }

          throw new Error(`No LLM mock found for prompt: ${userMessage.substring(0, 100)}...`);
        },
      },
    };
  }
}
