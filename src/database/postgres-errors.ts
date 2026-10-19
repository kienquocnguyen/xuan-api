import { QueryFailedError } from 'typeorm';

/**
 * Factual question for D11 call-site translation: did this statement fail on the named unique constraint?
 * The owning service decides what that means; `http/` never sees database errors (I15).
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError = error.driverError as { code?: string; constraint?: string };
  return driverError.code === '23505' && driverError.constraint === constraint;
}

/**
 * Same question for a foreign key. Postgres reports a missing parent on insert/update as 23503
 * (`foreign_key_violation`), and deleting a still-referenced parent under `ON DELETE RESTRICT` as 23001
 * (`restrict_violation`): e.g. a grant for an unknown user, or deleting a lesson that has progress.
 */
export function isForeignKeyViolation(error: unknown, constraint: string): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError = error.driverError as { code?: string; constraint?: string };
  return (
    (driverError.code === '23503' || driverError.code === '23001') &&
    driverError.constraint === constraint
  );
}
