import { ValidationError } from "@platform/core";
import type { FeatureManifest, MigrationDefinition } from "../manifest/FeatureManifest.js";

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
      if (manifestMap.has(m.id)) {
        throw new ValidationError({
          message: `Duplicate feature ID '${m.id}' detected.`,
          userMessage: "Duplicate feature configuration",
          correlationId: `dep_duplicate_${m.id}`,
        });
      }
      manifestMap.set(m.id, m);
    }

    const permissionOwners = new Map<string, string>();
    for (const manifest of manifests) {
      for (const permission of manifest.permissions) {
        const owner = permissionOwners.get(permission.name);
        if (owner) {
          throw new ValidationError({
            message: `Permission '${permission.name}' is declared by both '${owner}' and '${manifest.id}'.`,
            userMessage: "Duplicate feature permission",
            correlationId: `dep_permission_collision_${permission.name}`,
          });
        }
        permissionOwners.set(permission.name, manifest.id);
      }
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

    for (const m of manifests) {
      if (visited.has(m.id)) continue;

      const path: string[] = [m.id];
      const dependencies = (featureId: string): string[] => {
        const manifest = manifestMap.get(featureId)!;
        return [
          ...manifest.dependencies,
          ...(manifest.optionalDependencies ?? []).filter((id) => manifestMap.has(id)),
        ];
      };
      const stack = [{ id: m.id, dependencies: dependencies(m.id), nextDependency: 0 }];
      visited.set(m.id, "visiting");

      while (stack.length > 0) {
        const frame = stack[stack.length - 1]!;
        if (frame.nextDependency < frame.dependencies.length) {
          const dependencyId = frame.dependencies[frame.nextDependency++]!;
          const state = visited.get(dependencyId);

          if (state === "visiting") {
            const cycleStart = path.indexOf(dependencyId);
            const cycle = [...path.slice(cycleStart), dependencyId].join(" -> ");
            throw new ValidationError({
              message: `Circular dependency detected in feature graph: ${cycle}`,
              userMessage: "Circular feature dependency error",
              correlationId: `dep_cycle_${dependencyId}`,
            });
          }
          if (state === "visited") continue;

          visited.set(dependencyId, "visiting");
          path.push(dependencyId);
          stack.push({
            id: dependencyId,
            dependencies: dependencies(dependencyId),
            nextDependency: 0,
          });
          continue;
        }

        visited.set(frame.id, "visited");
        order.push(manifestMap.get(frame.id)!);
        stack.pop();
        path.pop();
      }
    }

    // Collect ordered migrations
    const orderedMigrations: {
      featureId: string;
      migration: MigrationDefinition;
    }[] = [];
    for (const manifest of order) {
      const sortedMigs = [...manifest.migrations].sort((a, b) => a.version - b.version);
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
