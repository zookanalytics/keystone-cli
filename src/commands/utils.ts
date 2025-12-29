/**
 * Shared utilities for CLI commands
 */

import { LIMITS } from '../utils/constants.ts';

const MAX_INPUT_STRING_LENGTH = LIMITS.MAX_INPUT_STRING_LENGTH;

/**
 * Parse CLI input pairs (key=value) into a record.
 * Attempts JSON parsing for complex types, falls back to string for simple values.
 *
 * @param pairs Array of key=value strings
 * @returns Record of parsed inputs
 */
export const parseInputs = (pairs?: string[]): Record<string, unknown> => {
  const inputs: Record<string, unknown> = Object.create(null);
  const blockedKeys = new Set(['__proto__', 'prototype', 'constructor']);
  if (!pairs) return inputs;
  for (const pair of pairs) {
    const index = pair.indexOf('=');
    if (index <= 0) {
      console.warn(`⚠️  Invalid input format: "${pair}" (expected key=value)`);
      continue;
    }
    const key = pair.slice(0, index);
    const value = pair.slice(index + 1);

    // Validate key format (no special characters that could cause issues)
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
      console.warn(`⚠️  Invalid input key: "${key}" (use alphanumeric and underscores only)`);
      continue;
    }
    if (blockedKeys.has(key)) {
      console.warn(`⚠️  Invalid input key: "${key}" (reserved keyword)`);
      continue;
    }

    try {
      // Attempt JSON parse for objects, arrays, booleans, numbers
      const parsed = JSON.parse(value);
      if (typeof parsed === 'string') {
        if (parsed.length > MAX_INPUT_STRING_LENGTH) {
          console.warn(
            `⚠️  Input "${key}" exceeds maximum length of ${MAX_INPUT_STRING_LENGTH} characters`
          );
          continue;
        }
        if (parsed.includes('\u0000')) {
          console.warn(`⚠️  Input "${key}" contains invalid null characters`);
          continue;
        }
      }
      inputs[key] = parsed;
    } catch {
      if (value.length > MAX_INPUT_STRING_LENGTH) {
        console.warn(
          `⚠️  Input "${key}" exceeds maximum length of ${MAX_INPUT_STRING_LENGTH} characters`
        );
        continue;
      }
      if (value.includes('\u0000')) {
        console.warn(`⚠️  Input "${key}" contains invalid null characters`);
        continue;
      }
      // Check if it looks like malformed JSON (starts with { or [)
      if ((value.startsWith('{') || value.startsWith('[')) && value.length > 1) {
        console.warn(
          `⚠️  Input "${key}" looks like JSON but failed to parse. Check for syntax errors.`
        );
        console.warn(`   Value: ${value.slice(0, 50)}${value.length > 50 ? '...' : ''}`);
      }
      // Fall back to string value
      inputs[key] = value;
    }
  }
  return inputs;
};
