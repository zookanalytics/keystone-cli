import { type ChildProcess, spawn } from 'node:child_process';
import { type Interface, createInterface } from 'node:readline';

interface MCPTool {
  name: string;
  description?: string;
  inputSchema: unknown;
}

interface MCPResponse {
  id?: number;
  result?: {
    tools?: MCPTool[];
    content?: Array<{ type: string; text: string }>;
    [key: string]: unknown;
  };
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export class MCPClient {
  private process: ChildProcess;
  private rl: Interface;
  private messageId = 0;
  private pendingRequests = new Map<number, (response: MCPResponse) => void>();
  private timeout: number;

  constructor(
    command: string,
    args: string[] = [],
    env: Record<string, string> = {},
    timeout = 30000
  ) {
    this.timeout = timeout;
    this.process = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    if (!this.process.stdout || !this.process.stdin) {
      throw new Error('Failed to start MCP server: stdio not available');
    }

    this.rl = createInterface({
      input: this.process.stdout,
    });

    this.rl.on('line', (line) => {
      try {
        const response = JSON.parse(line) as MCPResponse;
        if (response.id !== undefined && this.pendingRequests.has(response.id)) {
          const resolve = this.pendingRequests.get(response.id);
          if (resolve) {
            this.pendingRequests.delete(response.id);
            resolve(response);
          }
        }
      } catch (e) {
        // Ignore non-JSON lines
      }
    });
  }

  private async request(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<MCPResponse> {
    const id = this.messageId++;
    const message = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, resolve);
      this.process.stdin?.write(`${JSON.stringify(message)}\n`);

      // Add a timeout
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`MCP request timeout: ${method}`));
        }
      }, this.timeout);
    });
  }

  async initialize() {
    return this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'keystone-cli',
        version: '0.1.0',
      },
    });
  }

  async listTools(): Promise<MCPTool[]> {
    const response = await this.request('tools/list');
    return response.result?.tools || [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const response = await this.request('tools/call', {
      name,
      arguments: args,
    });
    if (response.error) {
      throw new Error(`MCP tool call failed: ${JSON.stringify(response.error)}`);
    }
    return response.result;
  }

  stop() {
    this.process.kill();
  }
}
