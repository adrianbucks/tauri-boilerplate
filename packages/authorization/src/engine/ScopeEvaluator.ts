import type { ResourceScope } from "../types.js";

export class ScopeEvaluator {
  /**
   * Evaluates if a requested resource scope satisfies the granted constraints.
   * - An empty/undefined constraint grants access to all resources within the organisation.
   * - A non-empty constraint requires all specified key/value pairs to match in the request.
   */
  static matches(
    grantConstraints?: ResourceScope,
    requestedScope?: ResourceScope,
  ): boolean {
    if (!grantConstraints || Object.keys(grantConstraints).length === 0) {
      return true; // Unconstrained grant
    }

    if (!requestedScope) {
      return false; // Constraint exists but no scope was requested
    }

    for (const [key, value] of Object.entries(grantConstraints)) {
      if (requestedScope[key] !== value) {
        return false;
      }
    }

    return true;
  }
}
