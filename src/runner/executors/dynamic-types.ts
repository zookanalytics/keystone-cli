/**
 * Shared types for Dynamic Step feature
 */
import type { StepResult } from './types.ts';

export interface GeneratedStep {
  id: string;
  name: string;
  type: 'llm' | 'shell' | 'workflow' | 'file' | 'request';
  agent?: string;
  prompt?: string;
  run?: string;
  path?: string;
  op?: 'read' | 'write' | 'append';
  content?: string;
  needs?: string[];
  inputs?: Record<string, unknown>;
  allowStepFailure?: boolean;
}

export interface DynamicPlan {
  workflow_id?: string;
  steps: GeneratedStep[];
  notes?: string;
}

/**
 * State for tracking dynamic step execution
 */
export interface DynamicStepState {
  // Identity
  id?: string; // Database ID (optional for in-memory)
  workflowId: string; // The workflow instance ID
  runId?: string; // The higher-level run ID
  stepId?: string; // The step ID within the workflow

  // State
  status: 'planning' | 'awaiting_confirmation' | 'executing' | 'completed' | 'failed';
  generatedPlan: DynamicPlan;

  // Execution tracking
  stepResults: Map<string, StepResult>;
  currentStepIndex: number;
  replanCount: number;

  // Timing & Metadata
  startedAt: string;
  completedAt?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Individual generated step execution record
 */
export interface DynamicStepExecution {
  id: string;
  stateId: string;
  stepId: string;
  stepName: string;
  stepType: string;
  stepDefinition: GeneratedStep;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  output?: unknown;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  executionOrder: number;
}
