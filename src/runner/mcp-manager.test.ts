import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import * as child_process from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { ConfigLoader } from '../utils/config-loader';
import { MCPClient } from './mcp-client';
import { MCPManager } from './mcp-manager';

describe('MCPManager', () => {
  let spawnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    ConfigLoader.clear();

    const mockProcess = Object.assign(new EventEmitter(), {
      stdout: new Readable({ read() {} }),
      stdin: new Writable({
        write(_chunk, _encoding, cb) {
          cb();
        },
      }),
      kill: mock(() => {}),
    });
    spawnSpy = spyOn(child_process, 'spawn').mockReturnValue(
      mockProcess as unknown as child_process.ChildProcess
    );
  });

  afterEach(() => {
    ConfigLoader.clear();
    spawnSpy.mockRestore();
  });

  it('should load global config on initialization', () => {
    ConfigLoader.setConfig({
      mcp_servers: {
        'test-server': {
          type: 'local',
          command: 'node',
          args: ['test.js'],
          env: { FOO: 'bar' },
        },
      } as any,
      providers: {},
      model_mappings: {},
      default_provider: 'openai',
    });

    const manager = new MCPManager();
    const servers = manager.getGlobalServers();
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe('test-server');
    expect(servers[0].command).toBe('node');
  });

  it('should get client for global server', async () => {
    ConfigLoader.setConfig({
      mcp_servers: {
        'test-server': {
          type: 'local',
          command: 'node',
        },
      } as any,
      providers: {},
      model_mappings: {},
      default_provider: 'openai',
    });

    const initSpy = spyOn(MCPClient.prototype, 'initialize').mockResolvedValue({
      result: { protocolVersion: '1.0' },
      jsonrpc: '2.0',
      id: 0,
    });
    const stopSpy = spyOn(MCPClient.prototype, 'stop').mockReturnValue(undefined);

    const manager = new MCPManager();
    const client = await manager.getClient('test-server');

    expect(client).toBeDefined();
    expect(initSpy).toHaveBeenCalled();

    // Should reuse client
    const client2 = await manager.getClient('test-server');
    expect(client2).toBe(client);
    expect(initSpy).toHaveBeenCalledTimes(1);

    await manager.stopAll();
    expect(stopSpy).toHaveBeenCalled();

    initSpy.mockRestore();
    stopSpy.mockRestore();
  });

  it('should get client for ad-hoc server config', async () => {
    const initSpy = spyOn(MCPClient.prototype, 'initialize').mockResolvedValue({
      result: { protocolVersion: '1.0' },
      jsonrpc: '2.0',
      id: 0,
    });

    const manager = new MCPManager();
    const client = await manager.getClient({
      name: 'adhoc',
      type: 'local',
      command: 'node',
    });

    expect(client).toBeDefined();
    expect(initSpy).toHaveBeenCalled();

    initSpy.mockRestore();
  });

  it('should return undefined if global server not found', async () => {
    const manager = new MCPManager();
    const client = await manager.getClient('non-existent');
    expect(client).toBeUndefined();
  });

  it('should handle connection failure', async () => {
    ConfigLoader.setConfig({
      mcp_servers: {
        'fail-server': {
          type: 'local',
          command: 'fail',
        },
      } as any,
      providers: {},
      model_mappings: {},
      default_provider: 'openai',
    });

    const createLocalSpy = spyOn(MCPClient, 'createLocal').mockImplementation(
      async (cmd: string) => {
        const client = new (MCPClient as any)({
          send: async () => {},
          onMessage: () => {},
          close: () => {},
        });
        spyOn(client, 'initialize').mockRejectedValue(new Error('Connection failed'));
        spyOn(client, 'stop').mockReturnValue(undefined);
        return client;
      }
    );

    const manager = new MCPManager();
    const client = await manager.getClient('fail-server');

    expect(client).toBeUndefined();

    createLocalSpy.mockRestore();
  });
});
