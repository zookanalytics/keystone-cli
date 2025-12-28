import { dirname, join } from 'node:path';
import * as yaml from 'js-yaml';
import { z } from 'zod';
import { ExpressionEvaluator } from '../expression/evaluator.ts';
import { ResourceLoader } from '../utils/resource-loader.ts';
import { validateJsonSchemaDefinition } from '../utils/schema-validator.ts';
import { resolveAgentPath } from './agent-parser.ts';
import { type Workflow, WorkflowSchema } from './schema.ts';

export class WorkflowParser {
  /**
   * Load and validate a workflow from a YAML file
   */
  static loadWorkflow(path: string): Workflow {
    try {
      const content = ResourceLoader.readFile(path);
      if (content === null) {
        throw new Error(`Workflow file not found at ${path}`);
      }
      const raw = yaml.load(content);
      WorkflowParser.normalizeAliases(raw);
      const workflow = WorkflowSchema.parse(raw);
      const workflowDir = dirname(path);

      // Expand matrix strategies into foreach items
      WorkflowParser.applyMatrixStrategies(workflow);

      // Resolve implicit dependencies from expressions
      WorkflowParser.resolveImplicitDependencies(workflow);

      // Validate DAG (no circular dependencies)
      WorkflowParser.validateDAG(workflow);

      // Validate agents exist
      WorkflowParser.validateAgents(workflow, workflowDir);

      // Validate artifact steps
      WorkflowParser.validateArtifacts(workflow);

      // Validate errors block
      WorkflowParser.validateErrors(workflow);

      // Validate finally block
      WorkflowParser.validateFinally(workflow);

      return workflow;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issues = error.issues
          .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
          .join('\n');
        throw new Error(`Invalid workflow schema at ${path}:\n${issues}`);
      }
      if (error instanceof Error) {
        throw new Error(`Failed to parse workflow at ${path}: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Normalize legacy or alias field names before schema validation.
   */
  private static normalizeAliases(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) {
        WorkflowParser.normalizeAliases(item);
      }
      return;
    }

    const record = value as Record<string, unknown>;
    if ('autoHeal' in record && !('auto_heal' in record)) {
      record.auto_heal = record.autoHeal;
    }
    if ('autoHeal' in record) {
      record.autoHeal = undefined;
    }

    for (const child of Object.values(record)) {
      WorkflowParser.normalizeAliases(child);
    }
  }

  /**
   * Expand step.strategy.matrix into foreach expressions.
   */
  private static applyMatrixStrategies(workflow: Workflow): void {
    const allSteps = [...workflow.steps, ...(workflow.errors || []), ...(workflow.finally || [])];
    for (const step of allSteps) {
      if (!step.strategy?.matrix) continue;

      if (step.foreach) {
        throw new Error(`Step "${step.id}" cannot use both foreach and strategy.matrix`);
      }

      const matrix = step.strategy.matrix;
      const keys = Object.keys(matrix);
      if (keys.length === 0) {
        throw new Error(`Step "${step.id}" matrix must define at least one axis`);
      }

      let combos: Array<Record<string, unknown>> = [{}];
      for (const key of keys) {
        const values = matrix[key];
        if (!Array.isArray(values) || values.length === 0) {
          throw new Error(`Step "${step.id}" matrix axis "${key}" must have at least one value`);
        }
        combos = combos.flatMap((combo) =>
          values.map((value) => ({
            ...combo,
            [key]: value,
          }))
        );
      }

      step.foreach = JSON.stringify(combos);
      step.strategy = undefined;
    }
  }

  /**
   * Automatically detect step dependencies from expressions
   */
  private static resolveImplicitDependencies(workflow: Workflow): void {
    const allSteps = [...workflow.steps, ...(workflow.errors || []), ...(workflow.finally || [])];
    for (const step of allSteps) {
      const detected = new Set<string>();

      // Helper to scan any value for dependencies
      const scan = (value: unknown, depth = 0) => {
        if (depth > 100) {
          throw new Error('Maximum expression nesting depth exceeded (potential DOS attack)');
        }

        if (typeof value === 'string') {
          for (const dep of ExpressionEvaluator.findStepDependencies(value)) {
            detected.add(dep);
          }
        } else if (Array.isArray(value)) {
          for (const item of value) {
            scan(item, depth + 1);
          }
        } else if (value && typeof value === 'object') {
          for (const val of Object.values(value)) {
            scan(val, depth + 1);
          }
        }
      };

      // Scan all step properties
      scan(step);

      // Add detected dependencies to step.needs
      for (const depId of detected) {
        // Step cannot depend on itself
        if (depId !== step.id && !step.needs.includes(depId)) {
          step.needs.push(depId);
        }
      }
    }
  }

  /**
   * Validate that the workflow forms a valid DAG (no cycles)
   */
  private static validateDAG(workflow: Workflow): void {
    const stepMap = new Map(workflow.steps.map((step) => [step.id, step.needs]));
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycle = (stepId: string): boolean => {
      if (!visited.has(stepId)) {
        visited.add(stepId);
        recursionStack.add(stepId);

        const dependencies = stepMap.get(stepId) || [];
        for (const dep of dependencies) {
          if (!stepMap.has(dep)) {
            throw new Error(`Step "${stepId}" depends on non-existent step "${dep}"`);
          }
          if (!visited.has(dep) && hasCycle(dep)) {
            return true;
          }
          if (recursionStack.has(dep)) {
            return true;
          }
        }
      }
      recursionStack.delete(stepId);
      return false;
    };

    for (const step of workflow.steps) {
      if (hasCycle(step.id)) {
        throw new Error(`Circular dependency detected involving step "${step.id}"`);
      }
    }
  }

  /**
   * Validate that all agents referenced in LLM steps exist
   */
  private static validateAgents(workflow: Workflow, baseDir?: string): void {
    const allSteps = [...workflow.steps, ...(workflow.errors || []), ...(workflow.finally || [])];
    for (const step of allSteps) {
      if (step.type === 'llm') {
        try {
          resolveAgentPath(step.agent, baseDir);
        } catch (error) {
          throw new Error(`Agent "${step.agent}" referenced in step "${step.id}" not found.`);
        }
      }
    }
  }

  /**
   * Validate artifact steps have the required fields for their operation.
   */
  private static validateArtifacts(workflow: Workflow): void {
    const allSteps = [...workflow.steps, ...(workflow.errors || []), ...(workflow.finally || [])];
    for (const step of allSteps) {
      if (step.type !== 'artifact') continue;
      if (step.op === 'upload' && (!step.paths || step.paths.length === 0)) {
        throw new Error(`Artifact step "${step.id}" requires paths for upload`);
      }
      if (step.op === 'download' && !step.path) {
        throw new Error(`Artifact step "${step.id}" requires path for download`);
      }
    }
  }

  /**
   * Validate finally block
   */
  private static validateFinally(workflow: Workflow): void {
    if (!workflow.finally) return;

    const mainStepIds = new Set(workflow.steps.map((s) => s.id));
    const finallyStepIds = new Set<string>();

    for (const step of workflow.finally) {
      if (mainStepIds.has(step.id)) {
        throw new Error(`Step ID "${step.id}" in finally block conflicts with main steps`);
      }
      if (finallyStepIds.has(step.id)) {
        throw new Error(`Duplicate Step ID "${step.id}" in finally block`);
      }
      finallyStepIds.add(step.id);

      // Finally steps can only depend on main steps or previous finally steps
      for (const dep of step.needs) {
        if (!mainStepIds.has(dep) && !finallyStepIds.has(dep)) {
          throw new Error(
            `Finally step "${step.id}" depends on non-existent step "${dep}". Finally steps can only depend on main steps or previous finally steps.`
          );
        }
      }
    }
  }

  /**
   * Validate errors block
   */
  private static validateErrors(workflow: Workflow): void {
    if (!workflow.errors) return;

    const mainStepIds = new Set(workflow.steps.map((s) => s.id));
    const errorsStepIds = new Set<string>();
    const finallyStepIds = new Set((workflow.finally || []).map((s) => s.id));

    for (const step of workflow.errors) {
      if (mainStepIds.has(step.id)) {
        throw new Error(`Step ID "${step.id}" in errors block conflicts with main steps`);
      }
      if (finallyStepIds.has(step.id)) {
        throw new Error(`Step ID "${step.id}" in errors block conflicts with finally steps`);
      }
      if (errorsStepIds.has(step.id)) {
        throw new Error(`Duplicate Step ID "${step.id}" in errors block`);
      }
      errorsStepIds.add(step.id);

      // Errors steps can only depend on main steps or previous errors steps
      for (const dep of step.needs) {
        if (!mainStepIds.has(dep) && !errorsStepIds.has(dep)) {
          throw new Error(
            `Errors step "${step.id}" depends on non-existent step "${dep}". Errors steps can only depend on main steps or previous errors steps.`
          );
        }
      }
    }
  }

  /**
   * Perform topological sort on steps
   * Returns steps in execution order
   */
  static topologicalSort(workflow: Workflow): string[] {
    const stepMap = new Map(workflow.steps.map((step) => [step.id, step.needs]));
    const inDegree = new Map<string, number>();

    // Validate all dependencies exist before sorting
    for (const step of workflow.steps) {
      const needs = step.needs || [];
      for (const dep of needs) {
        if (!stepMap.has(dep)) {
          throw new Error(`Step "${step.id}" depends on non-existent step "${dep}"`);
        }
      }
    }

    // Calculate in-degree
    // In-degree = number of dependencies a step has
    for (const step of workflow.steps) {
      const needs = step.needs || [];
      inDegree.set(step.id, needs.length);
    }

    // Build reverse dependency map for O(1) lookups instead of O(n)
    const dependents = new Map<string, string[]>();
    for (const step of workflow.steps) {
      const needs = step.needs || [];
      for (const dep of needs) {
        if (!dependents.has(dep)) dependents.set(dep, []);
        dependents.get(dep)?.push(step.id);
      }
    }

    // Kahn's algorithm
    const queue: string[] = [];
    const result: string[] = [];

    // Add all nodes with in-degree 0
    for (const [stepId, degree] of inDegree.entries()) {
      if (degree === 0) {
        queue.push(stepId);
      }
    }

    let queueIndex = 0;
    while (queueIndex < queue.length) {
      const stepId = queue[queueIndex];
      queueIndex += 1;
      result.push(stepId);

      // Find all steps that depend on this step (O(1) lookup)
      for (const dependentId of dependents.get(stepId) || []) {
        const newDegree = (inDegree.get(dependentId) || 0) - 1;
        inDegree.set(dependentId, newDegree);
        if (newDegree === 0) {
          queue.push(dependentId);
        }
      }
    }

    if (result.length !== workflow.steps.length) {
      throw new Error('Topological sort failed - circular dependency detected');
    }

    return result;
  }

  /**
   * Strict validation for schema definitions and enums.
   */
  static validateStrict(workflow: Workflow, source?: string): void {
    const errors: string[] = [];

    const locateSchema = (
      stepId: string,
      field: 'inputSchema' | 'outputSchema'
    ): { line: number; column: number } | null => {
      if (!source) return null;
      const lines = source.split('\n');
      const escaped = stepId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const inlineId = new RegExp(`^\\s*-\\s*id:\\s*['"]?${escaped}['"]?\\s*(#.*)?$`);
      const idLine = new RegExp(`^\\s*id:\\s*['"]?${escaped}['"]?\\s*(#.*)?$`);

      let inStep = false;
      let stepIndent = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        const indent = line.match(/^\s*/)?.[0].length ?? 0;

        if (!inStep) {
          if (inlineId.test(line) || idLine.test(line)) {
            inStep = true;
            stepIndent = indent;
          }
          continue;
        }

        if (trimmed.startsWith('- ') && indent <= stepIndent) {
          inStep = false;
          if (inlineId.test(line) || idLine.test(line)) {
            inStep = true;
            stepIndent = indent;
          }
          continue;
        }

        if (trimmed.startsWith(`${field}:`)) {
          const column = line.indexOf(field) + 1;
          return { line: i + 1, column: column > 0 ? column : 1 };
        }
      }

      return null;
    };

    const allSteps = [...workflow.steps, ...(workflow.errors || []), ...(workflow.finally || [])];
    for (const step of allSteps) {
      if (step.inputSchema) {
        const result = validateJsonSchemaDefinition(step.inputSchema);
        if (!result.valid) {
          const location = locateSchema(step.id, 'inputSchema');
          const locSuffix = location
            ? ` (at line ${location.line}, column ${location.column})`
            : '';
          errors.push(`step "${step.id}" inputSchema${locSuffix}: ${result.error}`);
        }
      }
      if (step.outputSchema) {
        const result = validateJsonSchemaDefinition(step.outputSchema);
        if (!result.valid) {
          const location = locateSchema(step.id, 'outputSchema');
          const locSuffix = location
            ? ` (at line ${location.line}, column ${location.column})`
            : '';
          errors.push(`step "${step.id}" outputSchema${locSuffix}: ${result.error}`);
        }
      }
    }

    if (errors.length > 0) {
      throw new Error(`Strict validation failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
    }
  }
}
