import type { AppConfig, Logger } from "@platform/core";
import { ConsoleLogger, createDefaultConfig, SyncError } from "@platform/core";
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
import {
  TaskQueueService,
  TaskWorker,
  type TaskWorkerOptions,
  StorageMaintenanceWorker,
} from "@platform/tasks";
import {
  MaintenanceRegistry,
  MaintenanceOrchestrator,
  type MaintenanceReport,
} from "@platform/maintenance";
import type { SignFn } from "@platform/sync-protocol";
import type { SyncTransport } from "@platform/sync";
import { coreMigrations } from "./migrations/coreMigrations.js";

export interface PlatformSyncOptions {
  deviceId: string;
  organisationId: string;
  signerPublicKey?: string | undefined;
  signFn?: SignFn | undefined;
  transport?: SyncTransport | undefined;
}

export interface PlatformOptions {
  db: DatabaseConnection;
  config?: Partial<AppConfig> | undefined;
  logger?: Logger | undefined;
  syncOptions?: PlatformSyncOptions | undefined;
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
  /** @see configureSync — must be called before accessing this. */
  private _sync: SyncManager | null = null;
  readonly pairing: PairingService;
  readonly importEngine: ImportEngine;
  readonly conflicts: ConflictRegistry;
  readonly features: FeatureRegistry;
  /** Durable background task queue — enqueue and query tasks here. */
  readonly tasks: TaskQueueService;
  /** Background task execution supervisor — register handlers and call start(). */
  readonly taskWorker: TaskWorker;
  /** Storage compaction registry — register core and feature pruning policies here. */
  readonly maintenanceRegistry: MaintenanceRegistry;
  /** Storage compaction execution orchestrator — inspect or prune storage. */
  readonly maintenance: MaintenanceOrchestrator;
  /** Background task worker wrapper for periodic storage compaction. */
  readonly maintenanceWorker: StorageMaintenanceWorker;
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

    // Sync is configured lazily via configureSync().
    // If syncOptions are provided at construction time, configure immediately.
    if (options.syncOptions) {
      this._sync = new SyncManager({
        db: this.db,
        deviceId: options.syncOptions.deviceId,
        organisationId: options.syncOptions.organisationId,
        signerPublicKey: options.syncOptions.signerPublicKey,
        signFn: options.syncOptions.signFn,
        transport: options.syncOptions.transport,
      });
    }

    this.tasks = new TaskQueueService(this.db);
    this.taskWorker = new TaskWorker(this.db, {}, this.logger);

    this.maintenanceRegistry = new MaintenanceRegistry({
      includeCoreDefaults: true,
    });
    this.maintenance = new MaintenanceOrchestrator({
      connection: this.db,
      registry: this.maintenanceRegistry,
      logger: this.logger,
    });
    this.maintenanceWorker = new StorageMaintenanceWorker({
      orchestrator: this.maintenance,
      taskQueue: this.tasks,
      logger: this.logger,
    });
    this.taskWorker.register(StorageMaintenanceWorker.TASK_TYPE, this.maintenanceWorker.handle);
  }

  /**
   * Returns the configured SyncManager.
   *
   * @throws {SyncError} if `configureSync()` has not been called yet.
   *   Always call `configureSync()` during platform bootstrap (after a verified
   *   session is established) before accessing the sync API.
   */
  get sync(): SyncManager {
    if (!this._sync) {
      throw new SyncError({
        message:
          "[Platform] SyncManager is not configured. " +
          "Call platform.configureSync({ deviceId, organisationId, ... }) " +
          "before accessing platform.sync.",
        userMessage: "Sync is not yet initialised.",
        correlationId: "platform_sync_not_configured",
      });
    }
    return this._sync;
  }

  /**
   * Returns true if `configureSync()` has been called and the SyncManager
   * is available. Use this as a guard before accessing `platform.sync`.
   */
  isSyncConfigured(): boolean {
    return this._sync !== null;
  }

  /**
   * Configures or re-configures the SyncManager with verified device identity,
   * organisation scope, native signing delegate, and active transport.
   */
  configureSync(options: PlatformSyncOptions): void {
    this._sync = new SyncManager({
      db: this.db,
      deviceId: options.deviceId,
      organisationId: options.organisationId,
      signerPublicKey: options.signerPublicKey,
      signFn: options.signFn,
      transport: options.transport,
    });
  }

  registerFeature(options: RegisterFeatureOptions): void {
    this.features.registerFeature(options);

    // Register any declared sync policies
    if (options.manifest.syncPolicies) {
      for (const policy of options.manifest.syncPolicies) {
        this.conflicts.registerEntityPolicy(policy.entityType, policy.conflictPolicy);
      }
    }

    // Register any declared pruning policies
    if (options.manifest.pruningPolicies) {
      for (const policy of options.manifest.pruningPolicies) {
        this.maintenanceRegistry.registerPolicy(policy);
      }
    }
  }

  /**
   * Convenience method to trigger a storage maintenance compaction cycle.
   */
  async runMaintenance(options?: {
    skipVacuum?: boolean | undefined;
    batchSize?: number | undefined;
  }): Promise<MaintenanceReport> {
    return await this.maintenance.pruneAll(options);
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
      this.logger.info(`Applying ${coreMigrations.length} platform migrations...`);
      await this.migrationEngine.applyMigrations(coreMigrations);
    }
    if (featureMigrations.length > 0) {
      this.logger.info(`Applying ${featureMigrations.length} feature migrations...`);
      await this.migrationEngine.applyMigrations(featureMigrations);
    }

    // 3. Crash recovery: reset any RUNNING tasks left over from a previous crash.
    const recovered = await this.tasks.recoverHangingTasks();
    if (recovered > 0) {
      this.logger.warn(`Platform: recovered ${recovered} hanging task(s) from previous crash.`);
    }

    this.isInitialised = true;
    this.logger.info("Platform initialization complete.");
  }

  /**
   * Convenience method: starts the background task worker after registering
   * all task handlers.
   *
   * Call this AFTER `init()` and after registering all handlers via
   * `platform.taskWorker.register(type, handler)`.
   *
   * Providing `options` reconfigures the existing worker (poll interval,
   * concurrency, callbacks) without discarding registered handlers.
   */
  startTaskWorker(options?: TaskWorkerOptions): void {
    if (options) {
      // Reconfigure the existing worker so registered handlers are preserved.
      // Do NOT re-create the TaskWorker — that would unregister all handlers
      // including the StorageMaintenanceWorker (B-04).
      this.taskWorker.reconfigure(options);
    }
    this.taskWorker.start();
  }

  /**
   * Convenience method: stops the background task worker and waits for
   * in-flight tasks to drain.
   */
  async stopTaskWorker(): Promise<void> {
    await this.taskWorker.stop();
  }

  getRegisteredFeatures(): FeatureManifest[] {
    return this.features.getAllFeatures();
  }
}
