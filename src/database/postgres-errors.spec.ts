import { QueryFailedError } from 'typeorm';
import { isForeignKeyViolation, isUniqueViolation } from './postgres-errors.js';

/** A TypeORM query failure carrying the given Postgres driver error. */
const queryFailed = (driverError: { code: string; constraint: string }) =>
  new QueryFailedError('INSERT …', [], Object.assign(new Error('violation'), driverError));

describe('isForeignKeyViolation', () => {
  it('is true for a 23503 on the named constraint', () => {
    expect(isForeignKeyViolation(queryFailed({ code: '23503', constraint: 'fk_x' }), 'fk_x')).toBe(
      true,
    );
  });

  it('is true for a 23001 on the named constraint: deleting a parent row under ON DELETE RESTRICT', () => {
    expect(isForeignKeyViolation(queryFailed({ code: '23001', constraint: 'fk_x' }), 'fk_x')).toBe(
      true,
    );
  });

  it.each([
    ['another constraint', queryFailed({ code: '23503', constraint: 'fk_y' })],
    ['a unique violation on that name', queryFailed({ code: '23505', constraint: 'fk_x' })],
    ['a plain error', new Error('fk_x')],
  ])('is false for %s', (_case, error) => {
    expect(isForeignKeyViolation(error, 'fk_x')).toBe(false);
  });
});

describe('isUniqueViolation', () => {
  it('is true only for a 23505 on the named constraint', () => {
    expect(isUniqueViolation(queryFailed({ code: '23505', constraint: 'uq_x' }), 'uq_x')).toBe(
      true,
    );
    expect(isUniqueViolation(queryFailed({ code: '23503', constraint: 'uq_x' }), 'uq_x')).toBe(
      false,
    );
  });
});
