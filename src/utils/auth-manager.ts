import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface AuthData {
  github_token?: string;
  copilot_token?: string;
  copilot_expires_at?: number;
  openai_api_key?: string;
  anthropic_api_key?: string;
  [key: string]: string | number | undefined;
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

  static async loginWithDeviceFlow(): Promise<string | undefined> {
    const CLIENT_ID = '01ab8ac9400c4e429b23'; // GitHub CLI client_id
    const SCOPES = 'read:user,repo,copilot';

    try {
      // 1. Request device code
      const response = await fetch('https://github.com/login/device/code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          scope: SCOPES,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to get device code: ${response.statusText}`);
      }

      const data = (await response.json()) as {
        device_code: string;
        user_code: string;
        verification_uri: string;
        expires_in: number;
        interval: number;
      };

      console.log('\nTo authenticate with GitHub:');
      console.log(`1. Open ${data.verification_uri}`);
      console.log(`2. Enter code: ${data.user_code}\n`);

      // 2. Poll for access token
      const interval = (data.interval || 5) * 1000 + 1000;
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, interval));

        const pollResponse = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            client_id: CLIENT_ID,
            device_code: data.device_code,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }),
        });

        const pollData = (await pollResponse.json()) as {
          access_token?: string;
          error?: string;
          error_description?: string;
        };

        if (pollData.access_token) {
          return pollData.access_token;
        }

        if (pollData.error) {
          if (pollData.error === 'authorization_pending') {
            continue;
          }
          if (pollData.error === 'slow_down') {
            // Wait longer if requested
            await new Promise((resolve) => setTimeout(resolve, 5000));
            continue;
          }
          throw new Error(`Authentication failed: ${pollData.error_description || pollData.error}`);
        }
      }
    } catch (error) {
      console.error(
        '\n✗ Device flow authentication failed:',
        error instanceof Error ? error.message : error
      );
      return undefined;
    }
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
