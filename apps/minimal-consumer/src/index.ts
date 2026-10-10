import { Platform, type PlatformOptions } from "@platform/platform";
import { notesFeatureManifest } from "./notes/NotesManifest.js";
import { NotesService, type NotesSyncSigner } from "./notes/NotesService.js";

export * from "./notes/NotesTypes.js";
export * from "./notes/NotesManifest.js";
export * from "./notes/NotesRepository.js";
export * from "./notes/NotesService.js";

export interface MinimalConsumerApp {
  platform: Platform;
  notes: NotesService;
}

export interface MinimalConsumerAppOptions extends PlatformOptions {
  readonly notesSigner: NotesSyncSigner;
}

export async function createMinimalConsumerApp(
  options: MinimalConsumerAppOptions,
): Promise<MinimalConsumerApp> {
  const platform = new Platform(options);

  // Register only the minimal consumer domain feature
  platform.registerFeature({
    manifest: notesFeatureManifest,
  });

  await platform.init();

  const notes = new NotesService({
    db: platform.db,
    signer: options.notesSigner,
    auth: platform.auth,
    sync: platform.isSyncConfigured() ? platform.sync : undefined,
  });

  return {
    platform,
    notes,
  };
}
