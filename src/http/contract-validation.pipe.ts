import { StandardSchemaValidationPipe } from '@nestjs/common';
import { types } from 'node:util';

const BUILT_IN_TYPES = [Date, RegExp, Error, Map, Set, WeakMap, WeakSet] as const;

/**
 * The global Standard Schema pipe with an iterative `stripProtoKeys`. Nest's version recurses and runs
 * before the schema, so deeply nested JSON overflowed the stack (a 500) before any schema limit could
 * answer 400. Same rules as `@nestjs/common/utils/strip-proto-keys.util`, without recursion.
 */
export class ContractValidationPipe extends StandardSchemaValidationPipe {
  override stripProtoKeys(value: unknown): void {
    const stack: unknown[] = [value];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current == null || typeof current !== 'object' || types.isTypedArray(current)) continue;
      if (BUILT_IN_TYPES.some((type) => current instanceof type)) continue;
      if (Array.isArray(current)) {
        for (const item of current) stack.push(item); // no spread: a huge array would exceed the arg limit
        continue;
      }
      const record = current as Record<string, unknown>;
      Reflect.deleteProperty(record, '__proto__');
      Reflect.deleteProperty(record, 'prototype');
      const constructorType = record.constructor;
      if (constructorType && !(BUILT_IN_TYPES as readonly unknown[]).includes(constructorType)) {
        Reflect.deleteProperty(record, 'constructor');
      }
      for (const key in record) stack.push(record[key]);
    }
  }
}
