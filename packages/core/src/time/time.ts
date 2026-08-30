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
  const date = new Date(timestamp);
  return !isNaN(date.getTime()) && timestamp.endsWith("Z");
}
