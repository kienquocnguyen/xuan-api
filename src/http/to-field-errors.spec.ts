import { toFieldErrors } from './to-field-errors.js';

describe('toFieldErrors', () => {
  it.each([
    [
      'missing value',
      {
        code: 'invalid_type',
        expected: 'string',
        message: 'Invalid input: expected string, received undefined',
        path: ['email'],
      },
      [{ field: 'email', code: 'REQUIRED', message: 'This field is required.' }],
    ],
    [
      'wrong type',
      {
        code: 'invalid_type',
        expected: 'string',
        message: 'Invalid input: expected string, received number',
        path: ['address', 'city'],
      },
      [{ field: 'address.city', code: 'INVALID_TYPE', message: 'This value has the wrong type.' }],
    ],
    [
      'format',
      { code: 'invalid_format', format: 'email', message: 'Invalid email', path: ['email'] },
      [{ field: 'email', code: 'INVALID_FORMAT', message: 'This value has an invalid format.' }],
    ],
    [
      'string too long',
      { code: 'too_big', origin: 'string', maximum: 5, message: 'Too big', path: ['name'] },
      [{ field: 'name', code: 'TOO_LONG', message: 'This value is too long.' }],
    ],
    [
      'string too short',
      { code: 'too_small', origin: 'string', minimum: 1, message: 'Too small', path: ['name'] },
      [{ field: 'name', code: 'TOO_SHORT', message: 'This value is too short.' }],
    ],
    [
      'number too small',
      { code: 'too_small', origin: 'number', minimum: 1, message: 'Too small', path: ['n'] },
      [{ field: 'n', code: 'TOO_SMALL', message: 'This value is too small.' }],
    ],
    [
      'number too large',
      { code: 'too_big', origin: 'number', maximum: 9, message: 'Too big', path: ['n'] },
      [{ field: 'n', code: 'TOO_LARGE', message: 'This value is too large.' }],
    ],
    [
      'array index path',
      { code: 'too_big', origin: 'string', maximum: 3, message: 'Too big', path: ['tags', 0] },
      [{ field: 'tags.0', code: 'TOO_LONG', message: 'This value is too long.' }],
    ],
    [
      'object path segments',
      { code: 'invalid_format', message: 'x', path: [{ key: 'a' }, { key: 'b' }] },
      [{ field: 'a.b', code: 'INVALID_FORMAT', message: 'This value has an invalid format.' }],
    ],
    [
      'unknown keys expand per key',
      {
        code: 'unrecognized_keys',
        keys: ['isAdmin', 'role'],
        message: 'Unrecognized keys',
        path: ['address'],
      },
      [
        { field: 'address.isAdmin', code: 'UNKNOWN_FIELD', message: 'This field is not allowed.' },
        { field: 'address.role', code: 'UNKNOWN_FIELD', message: 'This field is not allowed.' },
      ],
    ],
    [
      'anything else',
      { code: 'custom', message: 'whatever', path: ['x'] },
      [{ field: 'x', code: 'INVALID', message: 'This value is invalid.' }],
    ],
  ])('%s', (_name, issue, expected) => {
    expect(toFieldErrors([issue])).toEqual(expected);
  });
});
