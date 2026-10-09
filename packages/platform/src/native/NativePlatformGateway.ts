export interface NativeInvoker {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}

export interface NativeDeviceIdentity {
  device_id: string;
  public_key: string;
  platform: string;
  application_id: string;
}

export interface NativeDatabaseHealth {
  db_path: string;
  sqlite_version: string;
  journal_mode: string;
  foreign_keys_enabled: boolean;
  integrity_check: string;
}

export interface NativeSessionView {
  user_id: string;
  device_id: string;
  organisation_id: string;
  permissions: string[];
}

export interface NativeBackgroundStatus {
  running: boolean;
}

export interface NativeSyncEndpointInfo {
  endpoint_id: string;
  addr_json: string;
}

export interface AuthenticateUserRequest {
  user_id: string;
  password: string;
}

export interface NativeWidgetRecord {
  id: string;
  organisation_id: string;
  name: string;
  sku: string;
  quantity: number;
  deleted_at: string | null;
}

export interface NativeOrganisationRecord {
  id: string;
  created_at: string;
  updated_at: string;
  name: string;
  domain: string | null;
  status: "ACTIVE" | "SUSPENDED" | "ARCHIVED";
}

export interface CreateNativeOrganisationRequest {
  name: string;
  domain?: string;
  correlation_id: string;
}

export interface CreateNativeWidgetRequest {
  organisation_id: string;
  sync_group_id: string;
  name: string;
  sku: string;
  quantity: number;
  description?: string;
  correlation_id: string;
}

export interface CreateNativeWidgetItem {
  name: string;
  sku: string;
  quantity: number;
  description?: string;
}

export interface CreateNativeWidgetsRequest {
  organisation_id: string;
  sync_group_id: string;
  correlation_id: string;
  widgets: CreateNativeWidgetItem[];
}

export interface VerifyMessageInput {
  public_key: string;
  message_hex: string;
  signature_hex: string;
}

export interface PlatformNativeGateway {
  getDeviceIdentity(): Promise<NativeDeviceIdentity>;
  getDatabaseHealth(): Promise<NativeDatabaseHealth>;
  getCurrentSession(): Promise<NativeSessionView | null>;
  getBackgroundStatus(): Promise<NativeBackgroundStatus>;
  getSyncEndpointInfo(): Promise<NativeSyncEndpointInfo>;
  signMessage(messageHex: string): Promise<string>;
  verifyMessage(request: VerifyMessageInput): Promise<boolean>;
  authenticateUser(request: AuthenticateUserRequest): Promise<NativeSessionView>;
  logoutUser(): Promise<void>;
  listWidgets(organisationId: string): Promise<NativeWidgetRecord[]>;
  createWidget(request: CreateNativeWidgetRequest): Promise<NativeWidgetRecord>;
  createWidgets(request: CreateNativeWidgetsRequest): Promise<NativeWidgetRecord[]>;
  listOrganisations(): Promise<NativeOrganisationRecord[]>;
  createOrganisation(request: CreateNativeOrganisationRequest): Promise<NativeOrganisationRecord>;
}

export function createPlatformNativeGateway(invoker: NativeInvoker): PlatformNativeGateway {
  return {
    getDeviceIdentity: () => invoker.invoke<NativeDeviceIdentity>("get_device_identity"),
    getDatabaseHealth: () => invoker.invoke<NativeDatabaseHealth>("get_database_health"),
    getCurrentSession: () => invoker.invoke<NativeSessionView | null>("get_current_session"),
    getBackgroundStatus: () => invoker.invoke<NativeBackgroundStatus>("background_status"),
    getSyncEndpointInfo: () => invoker.invoke<NativeSyncEndpointInfo>("sync_start_endpoint"),
    signMessage: (messageHex) =>
      invoker.invoke<string>("sign_message", {
        request: { message_hex: messageHex },
      }),
    verifyMessage: (request) => invoker.invoke<boolean>("verify_message", { request }),
    authenticateUser: (request) =>
      invoker.invoke<NativeSessionView>("authenticate_user", { request }),
    logoutUser: () => invoker.invoke<void>("logout_user"),
    listWidgets: (organisationId) =>
      invoker.invoke<NativeWidgetRecord[]>("list_widgets", {
        request: { organisation_id: organisationId },
      }),
    createWidget: (request) => invoker.invoke<NativeWidgetRecord>("create_widget", { request }),
    createWidgets: (request) => invoker.invoke<NativeWidgetRecord[]>("create_widgets", { request }),
    listOrganisations: () => invoker.invoke<NativeOrganisationRecord[]>("list_organisations"),
    createOrganisation: (request) =>
      invoker.invoke<NativeOrganisationRecord>("create_organisation", {
        request,
      }),
  };
}

/**
 * Creates a SignFn callback for SyncEnvelopeBuilder that delegates signing
 * exclusively to native Rust memory custody via PlatformNativeGateway.
 *
 * Adheres strictly to Invariant #5: private keys never touch JavaScript.
 */
export function createNativeSignFn(
  gateway: Pick<PlatformNativeGateway, "signMessage">,
): (canonicalBytes: Uint8Array) => Promise<string> {
  return async (canonicalBytes: Uint8Array): Promise<string> => {
    const hex = Array.from(canonicalBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return gateway.signMessage(hex);
  };
}

/**
 * Creates a VerifyFn callback for SyncEnvelopeBuilder that delegates signature
 * verification to native Rust Ed25519 primitives.
 */
export function createNativeVerifyFn(
  gateway: Pick<PlatformNativeGateway, "verifyMessage">,
): (signerPublicKey: string, canonicalBytes: Uint8Array, signatureHex: string) => Promise<boolean> {
  return async (
    signerPublicKey: string,
    canonicalBytes: Uint8Array,
    signatureHex: string,
  ): Promise<boolean> => {
    const hex = Array.from(canonicalBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return gateway.verifyMessage({
      public_key: signerPublicKey,
      message_hex: hex,
      signature_hex: signatureHex,
    });
  };
}
