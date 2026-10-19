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

/** Same question for a foreign key (23503): e.g. a grant for a user or course that doesn't exist. */
export function isForeignKeyViolation(error: unknown, constraint: string): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError = error.driverError as { code?: string; constraint?: string };
  return driverError.code === '23503' && driverError.constraint === constraint;
}
