import { ManifestValidator } from "../manifest/ManifestValidator.js";
import { ValidationError } from "@platform/core";
import {
  DependencyResolver,
  type ResolvedFeatureGraph,
} from "./DependencyResolver.js";
import type {
  FeatureManifest,
  PermissionDefinition,
  MigrationDefinition,
  SyncPolicyDefinition,
  NavigationItem,
} from "../manifest/FeatureManifest.js";

export interface RegisterFeatureOptions {
  manifest: FeatureManifest;
  routes?: unknown | undefined;
}

export class FeatureRegistry {
  private readonly registeredFeatures = new Map<string, FeatureManifest>();
  private resolvedGraph: ResolvedFeatureGraph | null = null;

  registerFeature(options: RegisterFeatureOptions): void {
    const { manifest } = options;
    ManifestValidator.validate(manifest);

    if (this.registeredFeatures.has(manifest.id)) {
      throw new ValidationError({
        message: `Feature '${manifest.id}' has already been registered.`,
        userMessage: "A feature was registered more than once",
        correlationId: `feat_duplicate_${manifest.id}`,
      });
    }

    this.registeredFeatures.set(manifest.id, manifest);
    this.resolvedGraph = null; // Invalidate cached graph
  }

  isInstalled(featureId: string): boolean {
    return this.registeredFeatures.has(featureId);
  }

  getFeature(featureId: string): FeatureManifest | undefined {
    return this.registeredFeatures.get(featureId);
  }

  getAllFeatures(): FeatureManifest[] {
    this.ensureResolved();
    return this.resolvedGraph!.orderedManifests;
  }

  getAllPermissions(): PermissionDefinition[] {
    const permissions: PermissionDefinition[] = [];
    for (const feature of this.getAllFeatures()) {
      permissions.push(...feature.permissions);
    }
    return permissions;
  }

  getAllMigrations(): { featureId: string; migration: MigrationDefinition }[] {
    this.ensureResolved();
    return this.resolvedGraph!.orderedMigrations;
  }

  getAllSyncPolicies(): SyncPolicyDefinition[] {
    const policies: SyncPolicyDefinition[] = [];
    for (const feature of this.getAllFeatures()) {
      if (feature.syncPolicies) {
        policies.push(...feature.syncPolicies);
      }
    }
    return policies;
  }

  getAllNavigationItems(): NavigationItem[] {
    const items: NavigationItem[] = [];
    for (const feature of this.getAllFeatures()) {
      if (feature.navigation) {
        items.push(...feature.navigation);
      }
    }
    return items.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  }

  private ensureResolved(): void {
    if (!this.resolvedGraph) {
      const manifests = Array.from(this.registeredFeatures.values());
      this.resolvedGraph = DependencyResolver.resolve(manifests);
    }
  }
}
