import React, { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Platform } from "@platform/platform";
import { NativeDatabaseConnection } from "@platform/database";
import { ImportEngine } from "@platform/import-export";
import { exampleFeatureManifest } from "@features/example-feature";
import { organisationsManifest } from "@features/organisations";
import { identityAdminManifest } from "@features/identity-admin";
import { type SyncState, IrohSyncTransport } from "@platform/sync";
import {
  createPlatformNativeGateway,
  createNativeSignFn,
  type NativeSessionView,
  type NativeDeviceIdentity,
  type PlatformNativeGateway,
} from "@platform/platform";

interface PlatformContextValue {
  platform: Platform | null;
  importEngine: ImportEngine | null;
  nativeGateway: PlatformNativeGateway | null;
  nativeSession: NativeSessionView | null;
  transport: IrohSyncTransport | null;
  authenticate: (request: { user_id: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  retryInitialization: () => Promise<void>;
  syncState: SyncState;
  isReady: boolean;
  error: string | null;
}

export const PlatformContext = React.createContext<PlatformContextValue>({
  platform: null,
  importEngine: null,
  nativeGateway: null,
  nativeSession: null,
  transport: null,
  authenticate: async () => undefined,
  logout: async () => undefined,
  retryInitialization: async () => undefined,
  syncState: "DISCONNECTED",
  isReady: false,
  error: null,
});

export function PlatformProvider({ children }: { children: React.ReactNode }) {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [importEngine, setImportEngine] = useState<ImportEngine | null>(null);
  const [nativeGateway] = useState<PlatformNativeGateway>(() =>
    createPlatformNativeGateway({ invoke }),
  );
  const [nativeSession, setNativeSession] = useState<NativeSessionView | null>(null);
  const [transport, setTransport] = useState<IrohSyncTransport | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("DISCONNECTED");
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unlistenRef = useRef<(() => void) | null>(null);
  const unlistenTickRef = useRef<(() => void) | null>(null);
  const syncUnsubscribeRef = useRef<(() => void) | null>(null);
  const transportRef = useRef<IrohSyncTransport | null>(null);
  const initializationStartedRef = useRef(false);

  const init = useCallback(async () => {
    if (initializationStartedRef.current) return;
    initializationStartedRef.current = true;
    setError(null);

    try {
      // Use native database connection that bridges to Rust DurableDatabase
      const db = new NativeDatabaseConnection(invoke);
      await db.init();

      const p = new Platform({
        db,
        config: {
          applicationName: "Platform Boilerplate Demo",
          applicationVersion: "0.1.0",
          environment: "development",
          logLevel: "info",
        },
      });

      p.registerFeature({ manifest: exampleFeatureManifest });
      p.registerFeature({ manifest: organisationsManifest });
      p.registerFeature({ manifest: identityAdminManifest });

      await p.init();

      setImportEngine(new ImportEngine(db));

      let existingSession: NativeSessionView | null = null;
      try {
        const restoredSession = await nativeGateway.getCurrentSession();
        if (restoredSession) {
          await p.sessions.restoreNativeSession(nativeGateway);
          existingSession = restoredSession;
          setNativeSession(restoredSession);
        }
      } catch {
        // Keep the UI unauthenticated when native and platform session state disagree.
        existingSession = null;
        setNativeSession(null);
        await nativeGateway.logoutUser().catch(() => undefined);
      }

      // Initialize native iroh transport and configure sync with native Ed25519 signing
      const syncTransport = new IrohSyncTransport({
        invoke,
        listen: <T,>(event: string, handler: (e: { payload: T }) => void) =>
          listen<T>(event, (e) => handler({ payload: e.payload })),
      });
      transportRef.current = syncTransport;
      setTransport(syncTransport);
      syncTransport.init().catch(() => {});

      let deviceIdentity: NativeDeviceIdentity | null = null;
      try {
        deviceIdentity = await nativeGateway.getDeviceIdentity();
      } catch {
        // Fallback if device identity is not yet initialized
      }

      p.configureSync({
        deviceId: deviceIdentity?.device_id ?? "dev_default",
        organisationId: existingSession?.organisation_id ?? "default_org",
        signerPublicKey: deviceIdentity?.public_key,
        signFn: createNativeSignFn(nativeGateway),
        transport: syncTransport,
      });

      syncUnsubscribeRef.current?.();
      syncUnsubscribeRef.current = p.sync.onStateChange((state) => {
        setSyncState(state);
      });
      setSyncState(p.sync.getState());

      // --- WP-016b: Start background scheduler at platform boot ---
      // background_start is idempotent. Calling it here (outside any React
      // component lifecycle) ensures the OutboxScheduler keeps running even
      // when the main window is hidden to the system tray.
      try {
        await invoke("background_start");
      } catch {
        // Non-fatal: log but do not block platform initialisation.
        // The scheduler may already be running if init() is called twice.
      }

      // Subscribe to tray-initiated "Sync Now" requests.
      // SECURITY: the payload is a UTC unix-second timestamp string only —
      // no credentials or private key material ever appear in this event.
      const unlisten = await listen<string>("background://sync-now-requested", (_event) => {
        // Re-invoke background_start as an idempotent sync-now trigger.
        // The OutboxScheduler will emit background://sync-tick on its next
        // tick; for an immediate drain the TypeScript OutboxSyncWorker
        // should subscribe to this channel independently.
        invoke("background_start").catch(() => {
          // Scheduler already running — no action needed.
        });
      });
      unlistenRef.current = unlisten;

      const unlistenTick = await listen<{ pending_count: number }>(
        "background://sync-tick",
        (event) => {
          if (p.isSyncConfigured()) {
            p.sync.setState(event.payload.pending_count > 0 ? "SYNCING" : "IDLE");
          }
        },
      );
      unlistenTickRef.current = unlistenTick;

      setPlatform(p);
      setIsReady(true);
    } catch (err) {
      unlistenRef.current?.();
      unlistenRef.current = null;
      unlistenTickRef.current?.();
      unlistenTickRef.current = null;
      syncUnsubscribeRef.current?.();
      syncUnsubscribeRef.current = null;
      const failedTransport = transportRef.current;
      transportRef.current = null;
      if (failedTransport) {
        await failedTransport.dispose().catch(() => undefined);
      }
      setPlatform(null);
      setImportEngine(null);
      setTransport(null);
      setIsReady(false);
      initializationStartedRef.current = false;
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [nativeGateway]);

  const retryInitialization = useCallback(async () => {
    await init();
  }, [init]);

  const authenticate = useCallback(
    async (request: { user_id: string; password: string }) => {
      const session = await nativeGateway.authenticateUser(request);
      if (!platform) {
        await nativeGateway.logoutUser();
        throw new Error("Platform is not ready to restore the authenticated session");
      }

      try {
        await platform.sessions.restoreNativeSession(nativeGateway);
      } catch (error) {
        await nativeGateway.logoutUser().catch(() => undefined);
        throw error;
      }

      try {
        const identity = await nativeGateway.getDeviceIdentity();
        platform.configureSync({
          deviceId: identity.device_id,
          organisationId: session.organisation_id,
          signerPublicKey: identity.public_key,
          signFn: createNativeSignFn(nativeGateway),
          transport: platform.sync.getTransport(),
        });
        syncUnsubscribeRef.current?.();
        syncUnsubscribeRef.current = platform.sync.onStateChange((state) => {
          setSyncState(state);
        });
        setSyncState(platform.sync.getState());
      } catch {
        // Device identity is provisioned during native startup; session restoration can proceed
        // while sync remains configured with the startup fallback identity.
      }

      setNativeSession(session);
    },
    [nativeGateway, platform],
  );

  const logout = useCallback(async () => {
    await nativeGateway.logoutUser();
    setNativeSession(null);
    if (platform) {
      platform.sessions.invalidateSession();
      if (platform.isSyncConfigured()) {
        platform.sync.setState("DISCONNECTED");
      }
    }
    setSyncState("DISCONNECTED");
  }, [nativeGateway, platform]);

  useEffect(() => {
    init();
    return () => {
      // Clean up tray event listener on unmount to prevent memory leaks.
      unlistenRef.current?.();
      unlistenTickRef.current?.();
      syncUnsubscribeRef.current?.();
      const activeTransport = transportRef.current;
      transportRef.current = null;
      if (activeTransport) {
        void activeTransport.dispose().catch(() => {
          // The native process is already shutting down or the endpoint is unavailable.
        });
      }
    };
  }, [init]);

  return (
    <PlatformContext.Provider
      value={{
        platform,
        importEngine,
        nativeGateway,
        nativeSession,
        transport,
        authenticate,
        logout,
        retryInitialization,
        syncState,
        isReady,
        error,
      }}
    >
      {children}
    </PlatformContext.Provider>
  );
}

export function usePlatform() {
  return React.useContext(PlatformContext);
}
