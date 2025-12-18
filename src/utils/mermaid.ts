import type { Workflow } from '../parser/schema';

export function generateMermaidGraph(workflow: Workflow): string {
  const lines = ['graph TD'];

  // 1. Add Nodes
  for (const step of workflow.steps) {
    // Sanitize ID for Mermaid
    const safeId = step.id.replace(/[^a-zA-Z0-9_]/g, '_');

    // Add type icon/label
    let label = `${step.id}\\n(${step.type})`;

    // Add specific details based on type
    if (step.type === 'llm') label = `${step.id}\\n🤖 ${step.agent}`;
    if (step.foreach) label += '\\n(📚 Loop)';
    if (step.if) label += '\\n❓ Conditional';

    // Styling based on type
    let style = '';
    switch (step.type) {
      case 'llm':
        style = ':::ai';
        break;
      case 'human':
        style = ':::human';
        break;
      case 'shell':
        style = ':::shell';
        break;
      default:
        style = ':::default';
    }

    lines.push(`  ${safeId}["${label}"]${style}`);
  }

  // 2. Add Edges (Dependencies)
  for (const step of workflow.steps) {
    const safeId = step.id.replace(/[^a-zA-Z0-9_]/g, '_');

    if (step.needs && step.needs.length > 0) {
      for (const need of step.needs) {
        const safeNeed = need.replace(/[^a-zA-Z0-9_]/g, '_');
        lines.push(`  ${safeNeed} --> ${safeId}`);
      }
    }
  }

  // 3. Define Styles
  lines.push('  classDef ai fill:#e1f5fe,stroke:#01579b,stroke-width:2px;');
  lines.push(
    '  classDef human fill:#fff3e0,stroke:#e65100,stroke-width:2px,stroke-dasharray: 5 5;'
  );
  lines.push('  classDef shell fill:#f3e5f5,stroke:#4a148c,stroke-width:1px;');
  lines.push('  classDef default fill:#fff,stroke:#333,stroke-width:1px;');

  return lines.join('\n');
}

/**
 * Renders a Mermaid graph as ASCII using mermaid-ascii.art
 */
export async function renderMermaidAsAscii(mermaid: string): Promise<string | null> {
  try {
    const response = await fetch('https://mermaid-ascii.art', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `mermaid=${encodeURIComponent(mermaid)}`,
    });

    if (!response.ok) {
      return null;
    }

    const ascii = await response.text();
    if (ascii.includes('Failed to render diagram')) {
      return null;
    }

    return ascii;
  } catch {
    return null;
  }
}
