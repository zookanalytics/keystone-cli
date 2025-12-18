import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface AuthData {
  github_token?: string;
  copilot_token?: string;
  copilot_expires_at?: number;
}

export const COPILOT_HEADERS = {
  'Editor-Version': 'vscode/1.96.2',
  'Editor-Plugin-Version': 'copilot-chat/0.23.1',
  'User-Agent': 'GithubCopilot/1.255.0',
};

export class AuthManager {
  private static getAuthPath(): string {
    if (process.env.KEYSTONE_AUTH_PATH) {
      return process.env.KEYSTONE_AUTH_PATH;
    }
    const dir = join(homedir(), '.keystone');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    return join(dir, 'auth.json');
  }

  static load(): AuthData {
    const path = AuthManager.getAuthPath();
    if (existsSync(path)) {
      try {
        return JSON.parse(readFileSync(path, 'utf8'));
      } catch {
        return {};
      }
    }
    return {};
  }

  static save(data: AuthData): void {
    const path = AuthManager.getAuthPath();
    const current = AuthManager.load();
    writeFileSync(path, JSON.stringify({ ...current, ...data }, null, 2));
  }

  static async getCopilotToken(): Promise<string | undefined> {
    const auth = AuthManager.load();

    // Check if we have a valid cached token
    if (
      auth.copilot_token &&
      auth.copilot_expires_at &&
      auth.copilot_expires_at > Date.now() / 1000 + 300
    ) {
      return auth.copilot_token;
    }

    if (!auth.github_token) {
      return undefined;
    }

    // Exchange GitHub token for Copilot token
    try {
      const response = await fetch('https://api.github.com/copilot_internal/v2/token', {
        headers: {
          Authorization: `token ${auth.github_token}`,
          ...COPILOT_HEADERS,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to get Copilot token: ${response.statusText}`);
      }

      const data = (await response.json()) as { token: string; expires_at: number };
      AuthManager.save({
        copilot_token: data.token,
        copilot_expires_at: data.expires_at,
      });

      return data.token;
    } catch (error) {
      console.error('Error refreshing Copilot token:', error);
      return undefined;
    }
  }
}
