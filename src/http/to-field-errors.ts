type PathSegment = PropertyKey | { readonly key: PropertyKey };

/** A Standard Schema issue. Zod adds `code` and more at runtime, so they're read defensively (vendor narrowing). */
export type SchemaIssue = {
  readonly message: string;
  readonly path?: ReadonlyArray<PathSegment>;
} & Record<string, unknown>;

export type FieldCode =
  | 'REQUIRED'
  | 'INVALID_TYPE'
  | 'INVALID_FORMAT'
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'TOO_SMALL'
  | 'TOO_LARGE'
  | 'UNKNOWN_FIELD'
  | 'INVALID';

export type FieldError = { field: string; message: string; code: FieldCode };

const messages: Record<FieldCode, string> = {
  REQUIRED: 'This field is required.',
  INVALID_TYPE: 'This value has the wrong type.',
  INVALID_FORMAT: 'This value has an invalid format.',
  TOO_SHORT: 'This value is too short.',
  TOO_LONG: 'This value is too long.',
  TOO_SMALL: 'This value is too small.',
  TOO_LARGE: 'This value is too large.',
  UNKNOWN_FIELD: 'This field is not allowed.',
  INVALID: 'This value is invalid.',
};

/** A huge invalid document can't produce thousands of entries (api-contract.md §4). */
const MAX_FIELD_ERRORS = 50;

export function toFieldErrors(issues: readonly SchemaIssue[]): FieldError[] {
  return issues
    .flatMap((issue) => {
      const base = toDotPath(issue.path ?? []);
      if (issue.code === 'unrecognized_keys' && Array.isArray(issue.keys)) {
        return issue.keys.map((key) => field(joinPath(base, String(key)), 'UNKNOWN_FIELD'));
      }
      return [field(base, codeFor(issue))];
    })
    .slice(0, MAX_FIELD_ERRORS);
}

function codeFor(issue: SchemaIssue): FieldCode {
  const isString = issue.origin === 'string' || issue.origin === 'array';
  switch (issue.code) {
    case 'invalid_type':
      // Spike (Step 1): Zod 4 reports a missing value as invalid_type "received undefined".
      return /received undefined/.test(issue.message) ? 'REQUIRED' : 'INVALID_TYPE';
    case 'invalid_format':
      return 'INVALID_FORMAT';
    case 'too_small':
      return isString ? 'TOO_SHORT' : 'TOO_SMALL';
    case 'too_big':
      return isString ? 'TOO_LONG' : 'TOO_LARGE';
    default:
      return 'INVALID';
  }
}

const field = (path: string, code: FieldCode): FieldError => ({
  field: path,
  message: messages[code],
  code,
});

const toDotPath = (path: ReadonlyArray<PathSegment>): string =>
  path
    .map((segment) =>
      String(typeof segment === 'object' && segment !== null ? segment.key : segment),
    )
    .join('.');

const joinPath = (base: string, key: string): string => (base ? `${base}.${key}` : key);
