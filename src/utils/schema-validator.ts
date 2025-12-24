import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  allowUnionTypes: true,
});

const objectCache = new WeakMap<object, ValidateFunction>();
const primitiveCache = new Map<string, ValidateFunction>();

function getValidator(schema: unknown): ValidateFunction {
  if (schema && typeof schema === 'object') {
    const cached = objectCache.get(schema);
    if (cached) return cached;
    const validate = ajv.compile(schema);
    objectCache.set(schema, validate);
    return validate;
  }

  const key = JSON.stringify(schema);
  const cached = primitiveCache.get(key);
  if (cached) return cached;
  const validate = ajv.compile(schema as boolean);
  primitiveCache.set(key, validate);
  return validate;
}

function formatInstancePath(path: string): string {
  if (!path) return '(root)';
  return path
    .replace(/\//g, '.')
    .replace(/\.(\d+)/g, '[$1]')
    .replace(/^\./, '');
}

export function formatSchemaErrors(errors?: ErrorObject[] | null): string[] {
  if (!errors || errors.length === 0) return ['(root): failed schema validation'];
  return errors.map((error) => {
    const location = formatInstancePath(error.instancePath);
    const message = error.message || 'failed schema validation';
    return `${location}: ${message}`;
  });
}

export function validateJsonSchema(
  schema: unknown,
  data: unknown
): { valid: true } | { valid: false; errors: string[] } {
  const validate = getValidator(schema);
  const valid = validate(data);
  if (valid) return { valid: true };
  return { valid: false, errors: formatSchemaErrors(validate.errors) };
}

export function validateJsonSchemaDefinition(
  schema: unknown
): { valid: true } | { valid: false; error: string } {
  try {
    getValidator(schema);
    return { valid: true };
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : String(error) };
  }
}
