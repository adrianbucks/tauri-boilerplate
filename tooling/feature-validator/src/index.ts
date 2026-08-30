import {
  ManifestValidator,
  DependencyResolver,
  type FeatureManifest,
} from "@platform/feature-system";

export function validateManifests(manifests: FeatureManifest[]): {
  valid: boolean;
  message: string;
} {
  try {
    for (const manifest of manifests) {
      ManifestValidator.validate(manifest);
    }
    const resolved = DependencyResolver.resolve(manifests);
    return {
      valid: true,
      message: `Successfully validated ${manifests.length} features. Dependency load order: ${resolved.orderedManifests.map((m) => m.id).join(" -> ")}`,
    };
  } catch (error) {
    return {
      valid: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

// CLI entry point
if (
  process.argv[1]?.endsWith("index.ts") ||
  process.argv[1]?.endsWith("index.js")
) {
  console.log("Feature validator running...");
}
