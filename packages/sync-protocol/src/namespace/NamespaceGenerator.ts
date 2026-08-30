import { ValidationError } from "@platform/core";

export interface NamespaceComponents {
  applicationId: string;
  organisationId: string;
  syncGroupId: string;
  featureId: string;
  entityType: string;
}

export class NamespaceGenerator {
  private static readonly SEGMENT_REGEX = /^[a-z0-9_-]+$/;

  /**
   * Generates a canonical namespace string from components.
   */
  static generate(components: NamespaceComponents): string {
    const {
      applicationId,
      organisationId,
      syncGroupId,
      featureId,
      entityType,
    } = components;

    for (const [key, value] of Object.entries(components)) {
      if (!value || !this.SEGMENT_REGEX.test(value)) {
        throw new ValidationError({
          message: `Invalid segment '${value}' for namespace key '${key}'. Segments must only contain lowercase alphanumeric characters, underscores, or hyphens.`,
          userMessage: "Invalid sync namespace segment",
          correlationId: `ns_val_${key}`,
        });
      }
    }

    return `${applicationId}/${organisationId}/${syncGroupId}/${featureId}/${entityType}`;
  }

  /**
   * Parses a canonical namespace string into components.
   */
  static parse(namespace: string): NamespaceComponents {
    const parts = namespace.split("/");
    if (parts.length !== 5) {
      throw new ValidationError({
        message: `Namespace '${namespace}' is invalid. Must contain exactly 5 segments: application/organisation/sync-group/feature/entity.`,
        userMessage: "Invalid sync namespace format",
        correlationId: "ns_parse_err",
      });
    }

    return {
      applicationId: parts[0]!,
      organisationId: parts[1]!,
      syncGroupId: parts[2]!,
      featureId: parts[3]!,
      entityType: parts[4]!,
    };
  }

  /**
   * Checks if a namespace matches a pattern.
   * Wildcards like `wms/acme/coventry/*` are supported.
   */
  static matches(pattern: string, namespace: string): boolean {
    if (pattern === "*" || pattern === namespace) {
      return true;
    }

    const patternSegments = pattern.split("/");
    const nsSegments = namespace.split("/");

    if (patternSegments.length > nsSegments.length) {
      return false;
    }

    for (let i = 0; i < patternSegments.length; i++) {
      const p = patternSegments[i]!;
      if (p === "*") return true;
      if (p !== nsSegments[i]) return false;
    }

    return patternSegments.length === nsSegments.length;
  }
}
