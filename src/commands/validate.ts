/**
 * keystone validate command
 * Validate workflow files
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { WorkflowParser } from '../parser/workflow-parser.ts';
import { WorkflowRegistry } from '../utils/workflow-registry.ts';

async function validateWorkflows(
  pathArg: string | undefined,
  options: { strict?: boolean; explain?: boolean }
): Promise<void> {
  const path = pathArg || '.keystone/workflows/';

  try {
    let files: string[] = [];
    if (existsSync(path) && (path.endsWith('.yaml') || path.endsWith('.yml'))) {
      files = [path];
    } else if (existsSync(path)) {
      const glob = new Bun.Glob('**/*.{yaml,yml}');
      for await (const file of glob.scan(path)) {
        files.push(join(path, file));
      }
    } else {
      try {
        const resolved = WorkflowRegistry.resolvePath(path);
        files = [resolved];
      } catch {
        console.error(`✗ Path not found: ${path}`);
        process.exit(1);
      }
    }

    if (files.length === 0) {
      console.log('⊘ No workflow files found to validate.');
      return;
    }

    console.log(`🔍 Validating ${files.length} workflow(s)...\n`);

    let successCount = 0;
    let failCount = 0;

    for (const file of files) {
      try {
        const workflow = WorkflowParser.loadWorkflow(file);
        if (options.strict) {
          const source = readFileSync(file, 'utf-8');
          WorkflowParser.validateStrict(workflow, source);
        }
        console.log(`  ✓ ${file.padEnd(40)} ${workflow.name} (${workflow.steps.length} steps)`);
        successCount++;
      } catch (error) {
        if (options.explain) {
          const { formatYamlError, renderError } = await import('../utils/error-renderer.ts');
          try {
            const source = readFileSync(file, 'utf-8');
            const formatted = formatYamlError(error as Error, source, file);
            console.error(renderError({ message: formatted.summary, source, filePath: file }));
          } catch {
            console.error(
              renderError({
                message: error instanceof Error ? error.message : String(error),
                filePath: file,
              })
            );
          }
        } else {
          console.error(
            `  ✗ ${file.padEnd(40)} ${error instanceof Error ? error.message : String(error)}`
          );
        }
        failCount++;
      }
    }

    console.log(`\nSummary: ${successCount} passed, ${failCount} failed.`);
    if (failCount > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('✗ Validation failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

export function registerValidateCommand(program: Command): void {
  program
    .command('validate')
    .description('Validate workflow files')
    .argument('[path]', 'Workflow file or directory to validate (default: .keystone/workflows/)')
    .option('--strict', 'Enable strict validation (schemas, enums)')
    .option('--explain', 'Show detailed error context with suggestions')
    .action(async (pathArg, options) => {
      await validateWorkflows(pathArg, options);
    });

  // Also register lint as an alias
  program
    .command('lint')
    .description('Lint workflow files (alias of validate)')
    .argument('[path]', 'Workflow file or directory to lint (default: .keystone/workflows/)')
    .option('--strict', 'Enable strict validation (schemas, enums)')
    .option('--explain', 'Show detailed error context with suggestions')
    .action(async (pathArg, options) => {
      await validateWorkflows(pathArg, options);
    });
}
