/**
 * Postgres reports a unique index violation as SQLSTATE 23505, and MikroORM
 * carries that code through on the exception it throws. Used where losing a race
 * to another writer is a reason to skip a row, not to fail the request.
 */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    err.code === '23505'
  );
}
