import type { AppConfig, Logger } from "@platform/core";
import { ConsoleLogger, createDefaultConfig } from "@platform/core";
import type { DatabaseConnection } from "@platform/database";
import { MigrationEngine, type MigrationScript } from "@platform/database";
import { DeviceIdentityService, UserSessionService } from "@platform/identity";
import { AuthorizationEngine, SyncGroupService } from "@platform/authorization";
import { AuditService } from "@platform/audit";
import { SyncManager, PairingService } from "@platform/sync";
import { ConflictRegistry } from "@platform/sync-protocol";
import { ImportEngine } from "@platform/import-export";
import {
  FeatureRegistry,
  type RegisterFeatureOptions,
  type FeatureManifest,
} from "@platform/feature-system";
import { coreMigrations } from "./migrations/coreMigrations.js";

export interface PlatformOptions {
  db: DatabaseConnection;
  config?: Partial<AppConfig> | undefined;
  logger?: Logger | undefined;
}

export class Platform {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly db: DatabaseConnection;
  readonly identity: DeviceIdentityService;
  readonly sessions: UserSessionService;
  readonly auth: AuthorizationEngine;
  readonly syncGroups: SyncGroupService;
  readonly audit: AuditService;
  readonly sync: SyncManager;
  readonly pairing: PairingService;
  readonly importEngine: ImportEngine;
  readonly conflicts: ConflictRegistry;
  readonly features: FeatureRegistry;
  private readonly migrationEngine: MigrationEngine;
  private isInitialised = false;

  constructor(options: PlatformOptions) {
    this.config = createDefaultConfig(options.config);
    this.logger = options.logger ?? new ConsoleLogger(this.config.logLevel);
    this.db = options.db;

    this.features = new FeatureRegistry();
    this.conflicts = new ConflictRegistry();
    this.migrationEngine = new MigrationEngine(this.db);

    this.identity = new DeviceIdentityService(this.db);
    this.sessions = new UserSessionService(this.db);
    this.auth = new AuthorizationEngine(this.db);
    this.syncGroups = new SyncGroupService(this.db);
    this.audit = new AuditService(this.db);
    this.pairing = new PairingService(this.db);
    this.importEngine = new ImportEngine(this.db);

    this.sync = new SyncManager({
      db: this.db,
      deviceId: "pending_init",
      organisationId: "pending_init",
    });
  }

  registerFeature(options: RegisterFeatureOptions): void {
    this.features.registerFeature(options);

    // Register any declared sync policies
    if (options.manifest.syncPolicies) {
      for (const policy of options.manifest.syncPolicies) {
        this.conflicts.registerEntityPolicy(
          policy.entityType,
          policy.conflictPolicy,
        );
      }
    }
  }

  async init(): Promise<void> {
    if (this.isInitialised) return;

    this.logger.info("Initializing platform baseline...");

    // 1. Ensure platform migrations table
    await this.migrationEngine.ensureMigrationTable();

    // 2. Apply platform schema before feature-owned migrations.
    const orderedMigrations = this.features.getAllMigrations();
    const featureMigrations: MigrationScript[] = orderedMigrations.map((m) => ({
      ...m.migration,
      owner: `feature.${m.featureId}`,
    }));
    if (coreMigrations.length > 0) {
      this.logger.info(
        `Applying ${coreMigrations.length} platform migrations...`,
      );
      await this.migrationEngine.applyMigrations(coreMigrations);
    }
    if (featureMigrations.length > 0) {
      this.logger.info(
        `Applying ${featureMigrations.length} feature migrations...`,
      );
      await this.migrationEngine.applyMigrations(featureMigrations);
    }

    this.isInitialised = true;
    this.logger.info("Platform initialization complete.");
  }

  getRegisteredFeatures(): FeatureManifest[] {
    return this.features.getAllFeatures();
  }
}
