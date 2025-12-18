import { ConfigLoader } from '../utils/config-loader';
import { MCPClient } from './mcp-client';
import type { Logger } from './workflow-runner';

export interface MCPServerConfig {
  name: string;
  type?: 'local' | 'remote';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export class MCPManager {
  private clients: Map<string, MCPClient> = new Map();
  private sharedServers: Map<string, MCPServerConfig> = new Map();

  constructor() {
    this.loadGlobalConfig();
  }

  private loadGlobalConfig() {
    const config = ConfigLoader.load();
    if (config.mcp_servers) {
      for (const [name, server] of Object.entries(config.mcp_servers)) {
        this.sharedServers.set(name, {
          name,
          ...server,
        } as MCPServerConfig);
      }
    }
  }

  async getClient(
    serverRef: string | MCPServerConfig,
    logger: Logger = console
  ): Promise<MCPClient | undefined> {
    let config: MCPServerConfig;

    if (typeof serverRef === 'string') {
      const shared = this.sharedServers.get(serverRef);
      if (!shared) {
        logger.error(`  ✗ Global MCP server not found: ${serverRef}`);
        return undefined;
      }
      config = shared;
    } else {
      config = serverRef;
    }

    const key = this.getServerKey(config);
    if (this.clients.has(key)) {
      return this.clients.get(key);
    }

    logger.log(`  🔌 Connecting to MCP server: ${config.name} (${config.type || 'local'})`);

    let client: MCPClient;
    try {
      if (config.type === 'remote') {
        if (!config.url) throw new Error('Remote MCP server missing URL');
        client = await MCPClient.createRemote(config.url, config.headers || {});
      } else {
        if (!config.command) throw new Error('Local MCP server missing command');
        client = await MCPClient.createLocal(config.command, config.args || [], config.env || {});
      }

      await client.initialize();
      this.clients.set(key, client);
      return client;
    } catch (error) {
      logger.error(
        `  ✗ Failed to connect to MCP server ${config.name}: ${error instanceof Error ? error.message : String(error)}`
      );
      return undefined;
    }
  }

  private getServerKey(config: MCPServerConfig): string {
    return config.name;
  }

  getGlobalServers(): MCPServerConfig[] {
    return Array.from(this.sharedServers.values());
  }

  async stopAll() {
    for (const client of this.clients.values()) {
      client.stop();
    }
    this.clients.clear();
  }
}
