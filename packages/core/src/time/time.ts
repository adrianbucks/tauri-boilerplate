/**
 * Returns the current time as an ISO-8601 UTC string.
 * Example: `2026-08-30T10:00:00.000Z`
 */
export function getUtcIsoTimestamp(date = new Date()): string {
  return date.toISOString();
}

/**
 * Validates whether a string is a valid ISO-8601 UTC timestamp.
 */
export function isValidUtcIsoTimestamp(timestamp: string): boolean {
  if (typeof timestamp !== "string") return false;

  const match = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?Z$/.exec(
    timestamp,
  );
  if (!match) return false;

  const date = new Date(timestamp);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === match[1]
  );
}
