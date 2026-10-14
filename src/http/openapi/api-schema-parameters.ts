import { applyDecorators } from '@nestjs/common';
import { ApiParam, ApiQuery, type SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';

type ObjectJsonSchema = {
  type?: string;
  properties?: Record<string, SchemaObject>;
  required?: string[];
};

/**
 * Declares one OpenAPI parameter per property of the Zod object schema a route validates its query or path
 * with (`@Query({ schema })` / `@Param({ schema })`). @nestjs/swagger registers the named component (D17)
 * but can't expand it into parameters, because a `.meta({ id })` schema converts to a `$ref`.
 */
export function ApiSchemaParameters(location: 'query' | 'path', schema: z.ZodObject) {
  const converted = z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io: 'input',
  }) as ObjectJsonSchema & {
    $ref?: string;
    definitions?: Record<string, ObjectJsonSchema>;
  };
  const root = converted.$ref
    ? converted.definitions?.[converted.$ref.slice(converted.$ref.lastIndexOf('/') + 1)]
    : converted;
  if (root?.type !== 'object' || !root.properties) {
    throw new Error('ApiSchemaParameters needs a Zod object schema.');
  }
  if (JSON.stringify(root.properties).includes('"$ref"')) {
    throw new Error('ApiSchemaParameters does not support named schemas nested in parameters.');
  }
  const required = new Set(root.required ?? []);
  return applyDecorators(
    ...Object.entries(root.properties).map(([name, propertySchema]) =>
      location === 'path'
        ? ApiParam({ name, required: true, schema: propertySchema })
        : ApiQuery({ name, required: required.has(name), schema: propertySchema }),
    ),
  );
}
