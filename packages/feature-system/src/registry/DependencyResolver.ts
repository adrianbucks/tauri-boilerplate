import { ValidationError } from "@platform/core";
import type {
  FeatureManifest,
  MigrationDefinition,
} from "../manifest/FeatureManifest.js";

export interface ResolvedFeatureGraph {
  readonly orderedManifests: FeatureManifest[];
  readonly orderedMigrations: {
    featureId: string;
    migration: MigrationDefinition;
  }[];
}

export class DependencyResolver {
  static resolve(manifests: FeatureManifest[]): ResolvedFeatureGraph {
    const manifestMap = new Map<string, FeatureManifest>();
    for (const m of manifests) {
      manifestMap.set(m.id, m);
    }

    // Check for missing hard dependencies
    for (const manifest of manifests) {
      for (const depId of manifest.dependencies) {
        if (!manifestMap.has(depId)) {
          throw new ValidationError({
            message: `Feature '${manifest.id}' requires missing dependency '${depId}'.`,
            userMessage: "A required feature dependency is missing",
            correlationId: `dep_missing_${manifest.id}_${depId}`,
          });
        }
      }
    }

    // Build dependency graph for topological sorting & cycle detection
    // Edge A -> B means A depends on B (B must be initialized before A)
    const visited = new Map<string, "visiting" | "visited">();
    const order: FeatureManifest[] = [];

    const visit = (featureId: string, path: string[] = []) => {
      const state = visited.get(featureId);
      if (state === "visiting") {
        const cycle = [...path, featureId].join(" -> ");
        throw new ValidationError({
          message: `Circular dependency detected in feature graph: ${cycle}`,
          userMessage: "Circular feature dependency error",
          correlationId: `dep_cycle_${featureId}`,
        });
      }
      if (state === "visited") return;

      visited.set(featureId, "visiting");
      const manifest = manifestMap.get(featureId)!;

      // Visit hard dependencies first
      for (const depId of manifest.dependencies) {
        visit(depId, [...path, featureId]);
      }

      // Visit optional dependencies if present
      if (manifest.optionalDependencies) {
        for (const optId of manifest.optionalDependencies) {
          if (manifestMap.has(optId)) {
            visit(optId, [...path, featureId]);
          }
        }
      }

      visited.set(featureId, "visited");
      order.push(manifest);
    };

    for (const m of manifests) {
      if (!visited.has(m.id)) {
        visit(m.id);
      }
    }

    // Collect ordered migrations
    const orderedMigrations: {
      featureId: string;
      migration: MigrationDefinition;
    }[] = [];
    for (const manifest of order) {
      const sortedMigs = [...manifest.migrations].sort(
        (a, b) => a.version - b.version,
      );
      for (const migration of sortedMigs) {
        orderedMigrations.push({ featureId: manifest.id, migration });
      }
    }

    return {
      orderedManifests: order,
      orderedMigrations,
    };
  }
}
