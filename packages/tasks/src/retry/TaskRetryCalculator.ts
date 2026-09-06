/**
 * TaskRetryCalculator
 *
 * Computes next-attempt delay using bounded exponential backoff with jitter,
 * and classifies errors as retryable or non-retryable.
 *
 * Rules (from docs/architecture/BACKGROUND_TASKS.md):
 *   • AuthorizationError, ValidationError, CompatibilityError → non-retryable (permanent).
 *   • NetworkError, generic transient errors → retryable with backoff.
 *   • PlatformError.retryable flag is the authoritative source when present.
 */

import {
  PlatformError,
  AuthorizationError,
  ValidationError,
  CompatibilityError,
} from "@platform/core";
import type { TaskRetryPolicy } from "../types.js";

export interface RetryDecision {
  /** Whether the task should be retried. */
  readonly retryable: boolean;
  /** Computed delay in milliseconds before the next attempt. Undefined when not retryable. */
  readonly delayMs: number | undefined;
  /** Human-readable reason for the decision. */
  readonly reason: string;
}

/**
 * Classes of errors that are always treated as permanent failures.
 * Retrying them would be wasteful and potentially harmful.
 */
const NON_RETRYABLE_CLASSES: ReadonlyArray<new (...args: never[]) => Error> = [
  AuthorizationError,
  ValidationError,
  CompatibilityError,
];

export class TaskRetryCalculator {
  /**
   * Determines whether an error is retryable and, if so, how long to wait.
   *
   * @param error    - The thrown error from a task handler.
   * @param attempt  - The 1-based attempt number that just failed.
   * @param policy   - The task's retry policy.
   * @returns A `RetryDecision` describing what to do next.
   */
  decide(error: unknown, attempt: number, policy: TaskRetryPolicy): RetryDecision {
    // 1. If the error is a PlatformError with an explicit retryable flag, honour it.
    if (error instanceof PlatformError) {
      if (!error.retryable) {
        return {
          retryable: false,
          delayMs: undefined,
          reason: `Non-retryable PlatformError (${error.code}): ${error.message}`,
        };
      }
    }

    // 2. Hard-coded non-retryable error classes.
    for (const Cls of NON_RETRYABLE_CLASSES) {
      if (error instanceof Cls) {
        return {
          retryable: false,
          delayMs: undefined,
          reason: `Permanent error class ${Cls.name}; will not retry.`,
        };
      }
    }

    // 3. Attempts exhausted?
    if (attempt >= policy.maxAttempts) {
      return {
        retryable: false,
        delayMs: undefined,
        reason: `Attempt ${attempt} reached maxAttempts (${policy.maxAttempts}).`,
      };
    }

    // 4. Compute delay: min(maxDelay, initialDelay * (multiplier ^ (attempt - 1)))
    const base =
      policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt - 1);
    const capped = Math.min(base, policy.maxDelayMs);

    // Apply symmetric jitter: capped * (1 + random in [-jitter, +jitter])
    const jitterFactor = 1 + (Math.random() * 2 - 1) * policy.jitter;
    const delayMs = Math.max(0, Math.round(capped * jitterFactor));

    return {
      retryable: true,
      delayMs,
      reason: `Transient error; retry attempt ${attempt + 1} after ${delayMs}ms.`,
    };
  }

  /**
   * Convenience method: returns true if the given error class is always non-retryable.
   */
  isNonRetryableClass(error: unknown): boolean {
    for (const Cls of NON_RETRYABLE_CLASSES) {
      if (error instanceof Cls) return true;
    }
    if (error instanceof PlatformError && !error.retryable) return true;
    return false;
  }
}
