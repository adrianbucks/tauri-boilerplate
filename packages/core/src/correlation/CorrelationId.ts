/**
 * Generates a unique, timestamp-ordered correlation ID with an optional prefix.
 * Format: `<prefix>_<timestamp_hex><random_hex>`
 * Example: `req_01918a24c5817a0b3f8d9c`
 */
export function generateCorrelationId(prefix = "req"): string {
  const timestamp = Date.now().toString(16).padStart(12, "0");
  const randomBytes = new Uint8Array(8);

  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(randomBytes);
  } else {
    for (let i = 0; i < randomBytes.length; i++) {
      randomBytes[i] = Math.floor(Math.random() * 256);
    }
  }

  const randomHex = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return `${prefix}_${timestamp}${randomHex}`;
}
