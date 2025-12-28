import { describe, expect, it } from 'bun:test';
import { extractJson } from './json-parser';

describe('json-parser', () => {
  it('should extract JSON from markdown code blocks', () => {
    const text = 'Here is the data:\n```json\n{"foo": "bar"}\n```\nHope that helps!';
    expect(extractJson(text)).toEqual({ foo: 'bar' });
  });

  it('should extract JSON without markdown wrappers', () => {
    const text = 'The result is {"key": "value"} and it works.';
    expect(extractJson(text)).toEqual({ key: 'value' });
  });

  it('should handle nested structures with balanced braces', () => {
    const text =
      'Conversational preamble... {"outer": {"inner": [1, 2, 3]}, "active": true} conversational postscript.';
    expect(extractJson(text)).toEqual({ outer: { inner: [1, 2, 3] }, active: true });
  });

  it('should handle strings with escaped braces', () => {
    const text = 'Data: {"msg": "found a } brace", "id": 1}';
    expect(extractJson(text)).toEqual({ msg: 'found a } brace', id: 1 });
  });

  it('should handle array root objects', () => {
    const text = 'List: [{"id": 1}, {"id": 2}]';
    expect(extractJson(text)).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('should throw on empty input', () => {
    expect(() => extractJson('')).toThrow(/Failed to extract valid JSON/);
  });

  it('should throw if no JSON is found', () => {
    const text = 'Hello world, no JSON here!';
    expect(() => extractJson(text)).toThrow(/Failed to extract valid JSON/);
  });

  it('should throw if nesting depth is exceeded', () => {
    // Generate a string with 200 opening braces
    const text = '{'.repeat(200) + '}'.repeat(200);
    expect(() => extractJson(text)).toThrow(/structure nested too deeply/);
  });

  it('should throw if input text is too large', () => {
    // Generate a string larger than LIMITS.MAX_JSON_PARSE_LENGTH (1,000,000)
    const text = '{"a": "' + 'x'.repeat(1_000_001) + '"}';
    expect(() => extractJson(text)).toThrow(/input too large/);
  });
});
