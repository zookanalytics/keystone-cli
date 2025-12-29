/**
 * keystone doc command
 * Generate documentation for a workflow
 */

import type { Command } from 'commander';
import { WorkflowParser } from '../parser/workflow-parser.ts';
import { WorkflowRegistry } from '../utils/workflow-registry.ts';

export function registerDocCommand(program: Command): void {
  program
    .command('doc')
    .description('Generate Markdown documentation for a workflow')
    .argument('<workflow>', 'Workflow name or path to workflow file')
    .action(async (workflowPath) => {
      try {
        const resolvedPath = WorkflowRegistry.resolvePath(workflowPath);
        const workflow = WorkflowParser.loadWorkflow(resolvedPath);
        const { generateWorkflowDocs } = await import('../utils/doc-generator.ts');

        const markdown = generateWorkflowDocs(workflow);
        console.log(markdown);
      } catch (error) {
        console.error(
          '✗ Failed to generate documentation:',
          error instanceof Error ? error.message : error
        );
        process.exit(1);
      }
    });
}
