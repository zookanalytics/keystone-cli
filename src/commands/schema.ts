/**
 * keystone schema command
 * Generate JSON Schema for workflow definitions
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Command } from 'commander';

export function registerSchemaCommand(program: Command): void {
  program
    .command('schema')
    .description('Generate JSON Schema for workflow and agent definitions')
    .option('-o, --output <dir>', 'Output directory for schema files', '.keystone/schemas')
    .action(async (options) => {
      const { zodToJsonSchema } = await import('zod-to-json-schema');
      const { WorkflowSchema, AgentSchema } = await import('../parser/schema.ts');

      const workflowJsonSchema = zodToJsonSchema(WorkflowSchema as any, 'KeystoneWorkflow');
      (workflowJsonSchema as any).$schema = 'http://json-schema.org/draft-07/schema#';

      const agentJsonSchema = zodToJsonSchema(AgentSchema as any, 'KeystoneAgent');
      (agentJsonSchema as any).$schema = 'http://json-schema.org/draft-07/schema#';

      const outputDir = resolve(options.output);
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }

      writeFileSync(
        join(outputDir, 'workflow.schema.json'),
        JSON.stringify(workflowJsonSchema, null, 2)
      );
      writeFileSync(join(outputDir, 'agent.schema.json'), JSON.stringify(agentJsonSchema, null, 2));

      console.log(`✓ Generated JSON schemas in ${outputDir}/`);
      console.log('  - workflow.schema.json');
      console.log('  - agent.schema.json');
    });
}
