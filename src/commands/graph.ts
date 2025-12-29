/**
 * keystone graph command
 * Visualize a workflow as a graph
 */

import type { Command } from 'commander';
import { WorkflowParser } from '../parser/workflow-parser.ts';
import { generateMermaidGraph, renderWorkflowAsAscii } from '../utils/mermaid.ts';
import { WorkflowRegistry } from '../utils/workflow-registry.ts';

export function registerGraphCommand(program: Command): void {
    program
        .command('graph')
        .description('Visualize a workflow as a Mermaid.js graph')
        .argument('<workflow>', 'Workflow name or path to workflow file')
        .action(async (workflowPath) => {
            try {
                const resolvedPath = WorkflowRegistry.resolvePath(workflowPath);
                const workflow = WorkflowParser.loadWorkflow(resolvedPath);
                const ascii = renderWorkflowAsAscii(workflow);
                if (ascii) {
                    console.log(`\n${ascii}\n`);
                } else {
                    const mermaid = generateMermaidGraph(workflow);
                    console.log('\n```mermaid');
                    console.log(mermaid);
                    console.log('```\n');
                }
            } catch (error) {
                console.error('✗ Failed to generate graph:', error instanceof Error ? error.message : error);
                process.exit(1);
            }
        });
}
