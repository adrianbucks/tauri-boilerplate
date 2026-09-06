import React, { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Platform } from "@platform/platform";
import { NativeDatabaseConnection } from "@platform/database";
import { ImportEngine } from "@platform/import-export";
import { exampleFeatureManifest } from "@features/example-feature";
import { organisationsManifest } from "@features/organisations";
import { identityAdminManifest } from "@features/identity-admin";
import type { SyncState } from "@platform/sync";
import {
  createPlatformNativeGateway,
  type NativeSessionView,
  type PlatformNativeGateway,
} from "@platform/platform";

interface PlatformContextValue {
  platform: Platform | null;
  importEngine: ImportEngine | null;
  nativeGateway: PlatformNativeGateway | null;
  nativeSession: NativeSessionView | null;
  authenticate: (request: {
    user_id: string;
    password: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  syncState: SyncState;
  isReady: boolean;
  error: string | null;
}

export const PlatformContext = React.createContext<PlatformContextValue>({
  platform: null,
  importEngine: null,
  nativeGateway: null,
  nativeSession: null,
  authenticate: async () => undefined,
  logout: async () => undefined,
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
  const [nativeSession, setNativeSession] = useState<NativeSessionView | null>(
    null,
  );
  const [syncState] = useState<SyncState>("IDLE");
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const init = useCallback(async () => {
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

      setPlatform(p);
      setIsReady(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const authenticate = useCallback(
    async (request: { user_id: string; password: string }) => {
      const session = await nativeGateway.authenticateUser(request);
      setNativeSession(session);
    },
    [nativeGateway],
  );

  const logout = useCallback(async () => {
    await nativeGateway.logoutUser();
    setNativeSession(null);
  }, [nativeGateway]);

  useEffect(() => {
    init();
  }, [init]);

  return (
    <PlatformContext.Provider
      value={{
        platform,
        importEngine,
        nativeGateway,
        nativeSession,
        authenticate,
        logout,
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
