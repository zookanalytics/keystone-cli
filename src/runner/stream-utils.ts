import { ConsoleLogger, type Logger } from '../utils/logger.ts';
import type { LLMResponse, LLMToolCall } from './llm-adapter.ts';

// Maximum response size to prevent memory exhaustion (1MB)
const MAX_RESPONSE_SIZE = 1024 * 1024;

export async function processOpenAIStream(
  response: Response,
  options?: { onStream?: (chunk: string) => void; logger?: Logger },
  streamLabel = 'OpenAI'
): Promise<LLMResponse> {
  if (!response.body) throw new Error('Response body is null');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = '';
  const toolCalls: LLMToolCall[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n').filter((line: string) => line.trim() !== '');

    for (const line of lines) {
      if (line.includes('[DONE]')) continue;
      if (!line.startsWith('data: ')) continue;

      try {
        const data = JSON.parse(line.slice(6));

        // Handle Copilot's occasional 'choices' missing or different structure if needed,
        // but generally they match OpenAI.
        // Some proxies might return null delta.
        const delta = data.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          if (fullContent.length + delta.content.length > MAX_RESPONSE_SIZE) {
            throw new Error(`LLM response exceeds maximum size of ${MAX_RESPONSE_SIZE} bytes`);
          }
          fullContent += delta.content;
          options?.onStream?.(delta.content);
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            // biome-ignore lint/suspicious/noExplicitAny: External API type
            const toolCall = tc as any;
            if (!toolCalls[toolCall.index]) {
              toolCalls[toolCall.index] = {
                id: toolCall.id,
                type: 'function',
                function: { name: '', arguments: '' },
              };
            }
            const existing = toolCalls[toolCall.index];
            if (toolCall.function?.name) existing.function.name += toolCall.function.name;
            if (toolCall.function?.arguments)
              existing.function.arguments += toolCall.function.arguments;
          }
        }
      } catch (e) {
        const activeLogger = options?.logger || new ConsoleLogger();
        // Log non-SyntaxError exceptions at warning level (they indicate real issues)
        if (!(e instanceof SyntaxError)) {
          activeLogger.warn(`[${streamLabel} Stream] Error processing chunk: ${e}`);
        } else if (process.env.DEBUG || process.env.LLM_DEBUG) {
          // SyntaxErrors are normal for incomplete chunks - only log in debug mode
          activeLogger.debug?.(
            `[${streamLabel} Stream] Incomplete chunk parse: ${line.slice(0, 50)}...`
          );
        }
      }
    }
  }

  return {
    message: {
      role: 'assistant',
      content: fullContent || null,
      tool_calls: toolCalls.length > 0 ? toolCalls.filter(Boolean) : undefined,
    },
  };
}
