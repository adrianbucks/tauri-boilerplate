import React, { useState, useEffect, useCallback } from "react";
import { Platform } from "@platform/platform";
import { MemoryDatabaseConnection } from "@platform/database";
import { exampleFeatureManifest } from "@features/example-feature";
import { organisationsManifest } from "@features/organisations";
import { identityAdminManifest } from "@features/identity-admin";
import type { SyncState } from "@platform/sync";

interface PlatformContextValue {
  platform: Platform | null;
  syncState: SyncState;
  isReady: boolean;
  error: string | null;
}

export const PlatformContext = React.createContext<PlatformContextValue>({
  platform: null,
  syncState: "DISCONNECTED",
  isReady: false,
  error: null,
});

export function PlatformProvider({ children }: { children: React.ReactNode }) {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [syncState] = useState<SyncState>("IDLE");
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const init = useCallback(async () => {
    try {
      const db = new MemoryDatabaseConnection(":memory:");
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

      setPlatform(p);
      setIsReady(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    init();
  }, [init]);

  return (
    <PlatformContext.Provider value={{ platform, syncState, isReady, error }}>
      {children}
    </PlatformContext.Provider>
  );
}

export function usePlatform() {
  return React.useContext(PlatformContext);
}
