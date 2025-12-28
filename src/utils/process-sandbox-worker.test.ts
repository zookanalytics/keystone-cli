import { describe, expect, it } from 'bun:test';
import { ProcessSandbox } from './process-sandbox';

describe('ProcessSandbox Worker', () => {
    it('should execute a simple script in a worker', async () => {
        const code = 'return 1 + 2;';
        const result = await ProcessSandbox.execute(code, {}, { useWorker: true });
        expect(result).toBe(3);
    });

    it('should handle context in worker', async () => {
        const code = 'return a + b;';
        const context = { a: 10, b: 20 };
        const result = await ProcessSandbox.execute(code, context, { useWorker: true });
        expect(result).toBe(30);
    });

    it('should handle logs in worker', async () => {
        const logs: string[] = [];
        const logger = {
            log: (msg: string) => logs.push(msg),
            error: (msg: string) => logs.push(`ERROR: ${msg}`),
            warn: (msg: string) => logs.push(`WARN: ${msg}`),
            info: (msg: string) => logs.push(`INFO: ${msg}`),
            debug: (msg: string) => logs.push(`DEBUG: ${msg}`),
        };
        const code = 'console.log("hello"); return "ok";';
        const result = await ProcessSandbox.execute(code, {}, { useWorker: true, logger });
        expect(result).toBe('ok');
        expect(logs).toContain('hello');
    });

    it('should handle errors in worker', async () => {
        const code = 'throw new Error("worker error");';
        await expect(ProcessSandbox.execute(code, {}, { useWorker: true })).rejects.toThrow('worker error');
    });

    it('should timeout in worker', async () => {
        const code = 'while(true) {}';
        await expect(ProcessSandbox.execute(code, {}, { useWorker: true, timeout: 100 })).rejects.toThrow('timed out');
    });
});
