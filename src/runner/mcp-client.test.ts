import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { MCPClient } from './mcp-client';
import * as child_process from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';

interface MockProcess extends EventEmitter {
  stdout: Readable;
  stdin: Writable;
  kill: ReturnType<typeof mock>;
}

describe('MCPClient', () => {
  let mockProcess: MockProcess;
  let spawnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    const emitter = new EventEmitter();
    const stdout = new Readable({
      read() {},
    });
    const stdin = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const kill = mock(() => {});

    mockProcess = Object.assign(emitter, { stdout, stdin, kill }) as unknown as MockProcess;

    spawnSpy = spyOn(child_process, 'spawn').mockReturnValue(
      mockProcess as unknown as child_process.ChildProcess
    );
  });

  afterEach(() => {
    spawnSpy.mockRestore();
  });

  it('should initialize correctly', async () => {
    const client = new MCPClient('node', ['server.js']);
    const initPromise = client.initialize();

    // Simulate server response
    mockProcess.stdout.push(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        result: { protocolVersion: '2024-11-05' },
      })}\n`
    );

    const response = await initPromise;
    expect(response.result?.protocolVersion).toBe('2024-11-05');
    expect(spawnSpy).toHaveBeenCalledWith('node', ['server.js'], expect.any(Object));
  });

  it('should list tools', async () => {
    const client = new MCPClient('node');
    const listPromise = client.listTools();

    mockProcess.stdout.push(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        result: {
          tools: [{ name: 'test-tool', inputSchema: {} }],
        },
      })}\n`
    );

    const tools = await listPromise;
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('test-tool');
  });

  it('should call tool', async () => {
    const client = new MCPClient('node');
    const callPromise = client.callTool('my-tool', { arg: 1 });

    mockProcess.stdout.push(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        result: { content: [{ type: 'text', text: 'success' }] },
      })}\n`
    );

    const result = await callPromise;
    expect((result as { content: Array<{ text: string }> }).content[0].text).toBe('success');
  });

  it('should handle tool call error', async () => {
    const client = new MCPClient('node');
    const callPromise = client.callTool('my-tool', {});

    mockProcess.stdout.push(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        error: { code: -32000, message: 'Tool error' },
      })}\n`
    );

    await expect(callPromise).rejects.toThrow(/MCP tool call failed/);
  });

  it('should timeout on request', async () => {
    // Set a very short timeout for testing
    const client = new MCPClient('node', [], {}, 10);
    const requestPromise = client.initialize();

    // Don't push any response to stdout
    await expect(requestPromise).rejects.toThrow(/MCP request timeout/);
  });

  it('should stop the process', () => {
    const client = new MCPClient('node');
    client.stop();
    expect(mockProcess.kill).toHaveBeenCalled();
  });
});
