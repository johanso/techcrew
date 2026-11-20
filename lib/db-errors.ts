/**
 * Postgres errors as data, pure. postgres-js puts the SQLSTATE in `code` and the constraint in `constraint_name`;
 * Drizzle wraps query errors and keeps the driver's error as `cause`.
 */

const rec = (value: unknown): Record<string, unknown> | null => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null);

/** The error (or the error it wraps) is a unique violation of `constraint`. */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  for (let current = rec(error), depth = 0; current && depth < 4; current = rec(current.cause), depth++) {
    if (current.code === "23505" && current.constraint_name === constraint) return true;
  }
  return false;
}
