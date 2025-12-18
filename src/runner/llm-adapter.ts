import { AuthManager, COPILOT_HEADERS } from '../utils/auth-manager';
import { ConfigLoader } from '../utils/config-loader';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: LLMToolCall[];
}

export interface LLMToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface LLMResponse {
  message: LLMMessage;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface LLMTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface LLMAdapter {
  chat(
    messages: LLMMessage[],
    options?: { model?: string; tools?: LLMTool[] }
  ): Promise<LLMResponse>;
}

export class OpenAIAdapter implements LLMAdapter {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = apiKey || Bun.env.OPENAI_API_KEY || '';
    this.baseUrl = baseUrl || Bun.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

    if (!this.apiKey && this.baseUrl === 'https://api.openai.com/v1') {
      console.warn('Warning: OPENAI_API_KEY is not set.');
    }
  }

  async chat(
    messages: LLMMessage[],
    options?: { model?: string; tools?: LLMTool[] }
  ): Promise<LLMResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: options?.model || 'gpt-4o',
        messages,
        tools: options?.tools,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${error}`);
    }

    const data = (await response.json()) as {
      choices: { message: LLMMessage }[];
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };
    return {
      message: data.choices[0].message,
      usage: data.usage,
    };
  }
}

export class AnthropicAdapter implements LLMAdapter {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = apiKey || Bun.env.ANTHROPIC_API_KEY || '';
    this.baseUrl = baseUrl || Bun.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1';

    if (!this.apiKey && this.baseUrl === 'https://api.anthropic.com/v1') {
      console.warn('Warning: ANTHROPIC_API_KEY is not set.');
    }
  }

  async chat(
    messages: LLMMessage[],
    options?: { model?: string; tools?: LLMTool[] }
  ): Promise<LLMResponse> {
    const system = messages.find((m) => m.role === 'system')?.content || undefined;

    // Anthropic requires alternating user/assistant roles.
    // Sequential tool results must be grouped into a single user message.
    const anthropicMessages: Array<{
      role: 'user' | 'assistant';
      content: string | Array<Record<string, unknown>>;
    }> = [];

    for (const m of messages) {
      if (m.role === 'system') continue;

      if (m.role === 'tool') {
        const lastMsg = anthropicMessages[anthropicMessages.length - 1];
        const toolResult = {
          type: 'tool_result' as const,
          tool_use_id: m.tool_call_id,
          content: m.content,
        };

        if (lastMsg && lastMsg.role === 'user' && Array.isArray(lastMsg.content)) {
          // Append to existing tool result block if previous message was also a tool result
          lastMsg.content.push(toolResult);
        } else {
          // Start a new user message for tool results
          anthropicMessages.push({
            role: 'user',
            content: [toolResult],
          });
        }
      } else if (m.tool_calls) {
        anthropicMessages.push({
          role: 'assistant',
          content: [
            ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
            ...m.tool_calls.map((tc) => ({
              type: 'tool_use' as const,
              id: tc.id,
              name: tc.function.name,
              input: JSON.parse(tc.function.arguments),
            })),
          ],
        });
      } else {
        anthropicMessages.push({
          role: m.role as 'user' | 'assistant',
          content: m.content || '',
        });
      }
    }

    const anthropicTools = options?.tools
      ? options.tools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          input_schema: t.function.parameters,
        }))
      : undefined;

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: options?.model || 'claude-3-5-sonnet-20240620',
        system,
        messages: anthropicMessages,
        tools: anthropicTools,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} ${response.statusText} - ${error}`);
    }

    const data = (await response.json()) as {
      content: {
        type: 'text' | 'tool_use';
        text?: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      }[];
      usage: { input_tokens: number; output_tokens: number };
    };

    const content = data.content.find((c) => c.type === 'text')?.text || null;
    const toolCalls = data.content
      .filter((c) => c.type === 'tool_use')
      .map((c) => ({
        id: c.id as string,
        type: 'function' as const,
        function: {
          name: c.name as string,
          arguments: JSON.stringify(c.input),
        },
      }));

    return {
      message: {
        role: 'assistant',
        content,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      },
      usage: {
        prompt_tokens: data.usage.input_tokens,
        completion_tokens: data.usage.output_tokens,
        total_tokens: data.usage.input_tokens + data.usage.output_tokens,
      },
    };
  }
}

export class CopilotAdapter implements LLMAdapter {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || 'https://api.githubcopilot.com';
  }

  async chat(
    messages: LLMMessage[],
    options?: { model?: string; tools?: LLMTool[] }
  ): Promise<LLMResponse> {
    const token = await AuthManager.getCopilotToken();
    if (!token) {
      throw new Error('GitHub Copilot token not found. Please run "keystone auth login" first.');
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'vscode-editorid': 'vscode-chat',
        'vscode-machineid': 'default',
        ...COPILOT_HEADERS,
      },
      body: JSON.stringify({
        model: options?.model || 'gpt-4o',
        messages,
        tools: options?.tools,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Copilot API error: ${response.status} ${response.statusText} - ${error}`);
    }

    const data = (await response.json()) as {
      choices: { message: LLMMessage }[];
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };
    return {
      message: data.choices[0].message,
      usage: data.usage,
    };
  }
}

export function getAdapter(model: string): { adapter: LLMAdapter; resolvedModel: string } {
  const providerName = ConfigLoader.getProviderForModel(model);
  const config = ConfigLoader.load();
  const providerConfig = config.providers[providerName];

  if (!providerConfig) {
    throw new Error(`Provider configuration not found for: ${providerName}`);
  }

  let resolvedModel = model;
  if (model.includes(':')) {
    const [prefix, ...rest] = model.split(':');
    if (config.providers[prefix]) {
      resolvedModel = rest.join(':');
    }
  }

  let adapter: LLMAdapter;
  if (providerConfig.type === 'copilot') {
    adapter = new CopilotAdapter(providerConfig.base_url);
  } else {
    const apiKey = providerConfig.api_key_env ? Bun.env[providerConfig.api_key_env] : undefined;

    if (providerConfig.type === 'anthropic') {
      adapter = new AnthropicAdapter(apiKey, providerConfig.base_url);
    } else {
      adapter = new OpenAIAdapter(apiKey, providerConfig.base_url);
    }
  }

  return { adapter, resolvedModel };
}
