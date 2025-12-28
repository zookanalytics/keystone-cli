import type { Workflow } from '../parser/schema';

export function generateWorkflowDocs(workflow: Workflow): string {
  const parts: string[] = [];

  // Title and Description
  parts.push('# ' + workflow.name);
  if (workflow.description) {
    parts.push('\n' + workflow.description);
  }

  // Inputs
  if (workflow.inputs && Object.keys(workflow.inputs).length > 0) {
    parts.push('\n## Inputs');
    parts.push('\n| Name | Type | Default | Required | Description |');
    parts.push('| :--- | :--- | :--- | :--- | :--- |');

    for (const [name, input] of Object.entries(workflow.inputs)) {
      const typeStr = input.secret ? '**secret** (' + input.type + ')' : input.type;
      const defaultStr =
        input.default !== undefined ? '`' + JSON.stringify(input.default) + '`' : '-';
      const requiredStr = input.default === undefined ? 'Yes' : 'No';
      const descStr = input.description || '-';

      parts.push(
        '| `' +
          name +
          '` | ' +
          typeStr +
          ' | ' +
          defaultStr +
          ' | ' +
          requiredStr +
          ' | ' +
          descStr +
          ' |'
      );
    }
  }

  // Outputs
  if (workflow.outputs && Object.keys(workflow.outputs).length > 0) {
    parts.push('\n## Outputs');
    parts.push('\n| Name | Value Expression |');
    parts.push('| :--- | :--- |');

    for (const [name, expr] of Object.entries(workflow.outputs)) {
      parts.push('| `' + name + '` | `' + expr + '` |');
    }
  }

  // Steps
  if (workflow.steps && workflow.steps.length > 0) {
    parts.push('\n## Steps');

    // Simple list for now
    for (const step of workflow.steps) {
      const typeEmoji = getStepEmoji(step.type);
      const needs =
        step.needs && step.needs.length > 0 ? ' (needs: ' + step.needs.join(', ') + ')' : '';
      parts.push('\n### ' + typeEmoji + ' ' + step.id + ' `' + step.type + '`' + needs);

      if (step.if) {
        parts.push('\n*Condition:* `' + step.if + '`');
      }

      // Add specific step details
      if (step.type === 'shell' && 'run' in step) {
        parts.push('\n```bash\n' + step.run + '\n```');
      } else if (step.type === 'llm' && 'prompt' in step) {
        parts.push('\n*Agent:* `' + step.agent + '`');
        parts.push('\n> ' + step.prompt.replace(/\n/g, '\n> '));
      }
    }
  }

  return parts.join('\n');
}

function getStepEmoji(type: string): string {
  const map: Record<string, string> = {
    shell: '💻',
    llm: '🤖',
    request: '🌐',
    file: '📁',
    human: '👤',
    workflow: '📦',
    join: '🔗',
    script: '📜',
    sleep: '⏱️',
    wait: '⏳',
    memory: '🧠',
    artifact: '📦',
    engine: '🚂',
    plan: '📅',
    blueprint: '📐',
  };
  return map[type] || '⚡';
}
