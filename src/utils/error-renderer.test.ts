import { describe, expect, it } from 'bun:test';
import {
  formatError,
  formatExpressionError,
  formatYamlError,
  renderError,
} from './error-renderer';

describe('error-renderer', () => {
  describe('formatError', () => {
    it('should format basic error message', () => {
      const result = formatError({
        message: 'Something went wrong',
      });

      expect(result.summary).toBe('Something went wrong');
      expect(result.detail).toContain('❌ Error: Something went wrong');
    });

    it('should include step context', () => {
      const result = formatError({
        message: 'Step failed',
        stepId: 'build',
        stepType: 'shell',
      });

      expect(result.summary).toBe('[build] Step failed');
      expect(result.detail).toContain('📋 Step: build (shell)');
    });

    it('should include file location', () => {
      const result = formatError({
        message: 'Parse error',
        filePath: 'workflow.yaml',
        line: 10,
        column: 5,
      });

      expect(result.detail).toContain('📍 Location: workflow.yaml:10:5');
    });

    it('should provide suggestions for undefined variable', () => {
      const result = formatError({
        message: 'Undefined variable: step1',
      });

      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.suggestions.some((s) => s.includes('steps'))).toBe(true);
    });

    it('should provide suggestions for missing input', () => {
      const result = formatError({
        message: 'Missing required input: apiKey',
      });

      expect(result.suggestions.some((s) => s.includes('--input'))).toBe(true);
    });

    it('should provide suggestions for output schema validation', () => {
      const result = formatError({
        message: 'Output schema validation failed: missing field',
      });

      expect(result.suggestions.some((s) => s.includes('outputRetries'))).toBe(true);
    });

    it('should show source snippet when available', () => {
      const source = `name: test
steps:
  - id: s1
    type: shell
    run: echo hello`;

      const result = formatError({
        message: 'Error at line 3',
        source,
        line: 3,
        column: 5,
      });

      expect(result.detail).toContain('📄 Source:');
      expect(result.detail).toContain('id: s1');
    });

    it('should show step inputs when available', () => {
      const result = formatError({
        message: 'Input validation failed',
        stepId: 'process',
        stepInputs: { name: 'test', count: 5 },
      });

      expect(result.detail).toContain('📥 Step Inputs:');
      expect(result.detail).toContain('"name": "test"');
    });

    it('should include attempt count', () => {
      const result = formatError({
        message: 'Retry failed',
        attemptCount: 3,
      });

      expect(result.detail).toContain('🔄 Attempt: 3');
    });
  });

  describe('formatYamlError', () => {
    it('should extract line/column from YAML errors', () => {
      const error = new Error('bad indentation at line 5, column 3');
      const source = 'name: test\nsteps:\n  - id: s1\n   type: shell\n    run: echo';

      const result = formatYamlError(error, source, 'test.yaml');

      expect(result.detail).toContain('📍 Location: test.yaml:5:3');
      expect(result.suggestions.some((s) => s.includes('indentation'))).toBe(true);
    });

    it('should extract line number only when column is missing', () => {
      const error = new Error('unexpected token at line 3');
      const source = 'name: test\nsteps:\n  invalid';

      const result = formatYamlError(error, source, 'test.yaml');

      expect(result.detail).toContain('📍 Location: test.yaml:3');
    });

    it('should handle errors without line/column info', () => {
      const error = new Error('Generic YAML error');
      const source = 'name: test';

      const result = formatYamlError(error, source, 'test.yaml');

      expect(result.summary).toBe('Generic YAML error');
      expect(result.detail).toContain('📍 Location: test.yaml');
    });
  });

  describe('formatExpressionError', () => {
    it('should format expression error with step context', () => {
      const error = new Error('Undefined variable: foo');

      const result = formatExpressionError(error, 'foo + bar', 'my-step');

      expect(result.summary).toContain('[my-step]');
      expect(result.detail).toContain('📥 Step Inputs:');
      expect(result.detail).toContain('"expression": "foo + bar"');
    });

    it('should format expression error without step context', () => {
      const error = new Error('Invalid syntax');

      const result = formatExpressionError(error, 'invalid {{');

      expect(result.summary).toBe('Invalid syntax');
      expect(result.detail).toContain('"expression": "invalid {{"');
    });
  });

  describe('additional error patterns', () => {
    it('should provide suggestions for duplicate mapping key', () => {
      const result = formatError({
        message: 'duplicate mapping key found',
      });

      expect(result.suggestions.some((s) => s.includes('duplicate keys'))).toBe(true);
    });

    it('should provide suggestions for unexpected end', () => {
      const result = formatError({
        message: 'unexpected end of input',
      });

      expect(result.suggestions.some((s) => s.includes('unclosed'))).toBe(true);
    });

    it('should provide suggestions for could not find expected', () => {
      const result = formatError({
        message: 'could not find expected colon',
      });

      expect(result.suggestions.some((s) => s.includes('colon'))).toBe(true);
    });

    it('should provide suggestions for method on undefined/null', () => {
      const result = formatError({
        message: 'Cannot call method split on undefined',
      });

      expect(result.suggestions.some((s) => s.includes('optional chaining'))).toBe(true);
    });

    it('should provide suggestions for agent not found', () => {
      const result = formatError({
        message: 'Agent "my-agent" not found',
      });

      expect(result.suggestions.some((s) => s.includes('agents/my-agent.md'))).toBe(true);
    });

    it('should provide suggestions for input schema validation', () => {
      const result = formatError({
        message: 'Input schema validation failed',
      });

      expect(result.suggestions.some((s) => s.includes('inputSchema'))).toBe(true);
    });

    it('should provide shell step hints for step failure', () => {
      const result = formatError({
        message: 'Step build failed',
        stepType: 'shell',
      });

      expect(result.suggestions.some((s) => s.includes('shell command'))).toBe(true);
    });

    it('should provide llm step hints for step failure', () => {
      const result = formatError({
        message: 'Step generate failed',
        stepType: 'llm',
      });

      expect(result.suggestions.some((s) => s.includes('agent'))).toBe(true);
    });

    it('should extract line from simple line pattern', () => {
      const result = formatError({
        message: 'error at line 10',
        source: 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11',
      });

      expect(result.detail).toContain('📄 Source:');
      expect(result.detail).toContain('line10');
    });

    it('should provide hint for steps plural when variable starts with step', () => {
      const result = formatError({
        message: 'Undefined variable: step1',
      });

      expect(result.suggestions.some((s) => s.includes('steps'))).toBe(true);
      expect(result.suggestions.some((s) => s.includes('plural'))).toBe(true);
    });
  });

  describe('renderError', () => {
    it('should render with color codes when enabled', () => {
      const result = renderError(
        {
          message: 'Test error',
          stepId: 'test',
        },
        true
      );

      // Should contain ANSI escape codes
      expect(result).toContain('\x1b[');
    });

    it('should render plain text when color disabled', () => {
      const result = renderError(
        {
          message: 'Test error',
          stepId: 'test',
        },
        false
      );

      // Should not contain ANSI escape codes
      expect(result).not.toContain('\x1b[');
    });
  });
});
