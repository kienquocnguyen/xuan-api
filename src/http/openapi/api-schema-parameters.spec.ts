import { z } from 'zod';
import { ApiSchemaParameters } from './api-schema-parameters.js';

describe('ApiSchemaParameters', () => {
  it('accepts named and unnamed object schemas', () => {
    expect(() => ApiSchemaParameters('query', z.strictObject({ q: z.string() }))).not.toThrow();
    expect(() =>
      ApiSchemaParameters('path', z.strictObject({ id: z.uuid() }).meta({ id: 'ProbeTarget' })),
    ).not.toThrow();
  });

  it('refuses a schema that is not a plain object of properties', () => {
    const notAnObject = z.strictObject({ a: z.string() }).or(z.strictObject({ b: z.string() }));
    expect(() => ApiSchemaParameters('query', notAnObject as unknown as z.ZodObject)).toThrow(
      'needs a Zod object schema',
    );
  });

  it('refuses an optional path property, since a path segment is always present', () => {
    expect(() => ApiSchemaParameters('path', z.strictObject({ id: z.uuid().optional() }))).toThrow(
      'path parameters must be required',
    );
  });

  it('refuses a named schema nested in a parameter, whose $ref would dangle', () => {
    const nested = z.strictObject({ code: z.string() }).meta({ id: 'ProbeNested' });
    expect(() => ApiSchemaParameters('query', z.strictObject({ filter: nested }))).toThrow(
      'does not support named schemas nested in parameters',
    );
  });
});
