import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { stripVTControlCharacters } from 'node:util';
import { type ExpressionContext, ExpressionEvaluator } from '../expression/evaluator.ts';
import type { Step } from '../parser/schema.ts';
import { extractJson } from '../utils/json-parser.ts';

export type DebugAction =
  | { type: 'retry'; modifiedStep?: Step }
  | { type: 'skip' }
  | { type: 'continue_failure' }; // Default behavior (exit debug mode, let it fail)

export class DebugRepl {
  constructor(
    private context: ExpressionContext,
    private step: Step,
    private error: unknown,
    private inputStream: NodeJS.ReadableStream = process.stdin,
    private outputStream: NodeJS.WritableStream = process.stdout
  ) {}

  public async start(): Promise<DebugAction> {
    console.log(`\n❌ Step '${this.step.id}' failed.`);
    console.log(
      `   Error: ${this.error instanceof Error ? this.error.message : String(this.error)}`
    );
    console.log('\nEntering Debug Mode. Available commands:');
    console.log('  > context      (view current inputs/outputs involved in this step)');
    console.log('  > retry        (re-run step, optionally with edited definition)');
    console.log('  > edit         (edit the step definition in your $EDITOR)');
    console.log('  > skip         (skip this step and proceed)');
    console.log('  > eval <code>  (run JS expression against context)');
    console.log('  > exit         (resume failure/exit)');

    const rl = readline.createInterface({
      input: this.inputStream,
      output: this.outputStream,
      prompt: 'debug> ',
    });

    rl.prompt();

    return new Promise((resolve) => {
      rl.on('line', (line) => {
        const trimmed = line.trim();
        const [cmd, ...args] = trimmed.split(' ');
        const argStr = args.join(' ');

        switch (cmd) {
          case 'context':
            // Show meaningful context context
            console.log(JSON.stringify(this.context, null, 2));
            break;

          case 'retry':
            rl.close();
            resolve({ type: 'retry', modifiedStep: this.step });
            break;

          case 'skip':
            rl.close();
            resolve({ type: 'skip' });
            break;

          case 'exit':
          case 'quit':
            rl.close();
            resolve({ type: 'continue_failure' });
            break;

          case 'edit': {
            try {
              const newStep = this.editStep(this.step);
              if (newStep) {
                this.step = newStep;
                console.log('✓ Step definition updated in memory. Type "retry" to run it.');
              } else {
                console.log('No changes made.');
              }
            } catch (e) {
              console.error(`Error editing step: ${e}`);
            }
            break;
          }

          case 'eval':
            try {
              if (!argStr) {
                console.log('Usage: eval <expression>');
              } else {
                const result = ExpressionEvaluator.evaluateExpression(argStr, this.context);
                console.log(result);
              }
            } catch (e) {
              console.error(`Eval error: ${e instanceof Error ? e.message : String(e)}`);
            }
            break;

          case '':
            break;

          default:
            console.log(`Unknown command: ${cmd}`);
            break;
        }

        if (cmd !== 'retry' && cmd !== 'skip' && cmd !== 'exit' && cmd !== 'quit') {
          rl.prompt();
        }
      });
    });
  }

  private editStep(step: Step): Step | null {
    const editor = process.env.EDITOR || 'vim'; // Default to vim if not set
    const tempFile = path.join(os.tmpdir(), `keystone-step-${step.id}-${Date.now()}.json`);

    // Write step to temp file
    fs.writeFileSync(tempFile, JSON.stringify(step, null, 2));

    // Spawn editor
    try {
      // Use stdio: 'inherit' to let the editor take over the terminal
      const result = spawnSync(editor, [tempFile], {
        stdio: 'inherit',
        shell: true,
      });

      if (result.error) {
        throw result.error;
      }

      // Read back
      const content = fs.readFileSync(tempFile, 'utf-8');

      // Parse JSON
      // We use our safe extractor helper or just JSON.parse
      try {
        const newStep = JSON.parse(content);
        // Basic validation: must have id and type
        if (!newStep.id || !newStep.type) {
          console.error('Invalid step definition: missing id or type');
          return null;
        }
        return newStep as Step;
      } catch (e) {
        console.error('Failed to parse JSON from editor. Changes discarded.');
        return null;
      }
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  }
}
