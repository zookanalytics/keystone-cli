import { describe, expect, it, mock } from 'bun:test';
import type { Workflow } from '../parser/schema';
import { generateMermaidGraph } from './mermaid';

describe('mermaid', () => {
  it('should generate a mermaid graph from a workflow', () => {
    const workflow: Workflow = {
      name: 'test',
      steps: [
        { id: 's1', type: 'shell', run: 'echo 1', needs: [] },
        { id: 's2', type: 'llm', agent: 'my-agent', prompt: 'hi', needs: ['s1'] },
        { id: 's3', type: 'human', message: 'ok?', needs: ['s2'], if: 'true' },
      ],
    } as unknown as Workflow;

    const graph = generateMermaidGraph(workflow);
    expect(graph).toContain('graph TD');
    expect(graph).toContain('s1["s1\\n(shell)"]:::shell');
    expect(graph).toContain('s2["s2\\n🤖 my-agent"]:::ai');
    expect(graph).toContain('s3["s3\\n(human)\\n❓ Conditional"]:::human');
    expect(graph).toContain('s1 --> s2');
    expect(graph).toContain('s2 --> s3');
  });

  it('should handle loops in labeling', () => {
    const workflow: Workflow = {
      name: 'loop',
      steps: [{ id: 'l1', type: 'shell', run: 'echo', foreach: '[1,2]', needs: [] }],
    } as unknown as Workflow;
    const graph = generateMermaidGraph(workflow);
    expect(graph).toContain('(📚 Loop)');
  });

  it('should render mermaid as ascii', async () => {
    const originalFetch = global.fetch;
    // @ts-ignore
    global.fetch = mock(() =>
      Promise.resolve(
        new Response('ascii graph', {
          status: 200,
        })
      )
    );

    const { renderMermaidAsAscii } = await import('./mermaid');
    const result = await renderMermaidAsAscii('graph TD\n  A --> B');
    expect(result).toBe('ascii graph');

    global.fetch = originalFetch;
  });
});
