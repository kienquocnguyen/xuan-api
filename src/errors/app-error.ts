export type ErrorKind =
  'validation' | 'unauthenticated' | 'forbidden' | 'not_found' | 'conflict' | 'rate_limited';

export type ErrorDefinition = Readonly<{ code: string; kind: ErrorKind; message: string }>;

/** A business failure with stable meaning. HTTP status is assigned later by the filter (I14). */
export class AppError extends Error {
  readonly code: string;
  readonly kind: ErrorKind;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(definition: ErrorDefinition, details?: Record<string, unknown>) {
    super(definition.message);
    this.name = 'AppError';
    this.code = definition.code;
    this.kind = definition.kind;
    this.details = details;
  }
}
