/**
 * keystone event command
 * Trigger an event to resume waiting workflows
 */

import type { Command } from 'commander';
import { WorkflowDb } from '../db/workflow-db.ts';
import { container } from '../utils/container.ts';

export function registerEventCommand(program: Command): void {
    program
        .command('event')
        .description('Trigger an event to resume waiting workflows')
        .argument('<name>', 'Event name')
        .argument('[data]', 'Event data (JSON)')
        .action(async (name, dataStr) => {
            const db = container.resolve('db') as WorkflowDb;
            let data = null;
            if (dataStr) {
                try {
                    data = JSON.parse(dataStr);
                } catch {
                    data = dataStr;
                }
            }
            await db.storeEvent(name, data);
            console.log(`✓ Event '${name}' triggered.`);
        });
}
