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

export interface PlatformNativeGateway {
  getDeviceIdentity(): Promise<NativeDeviceIdentity>;
  getDatabaseHealth(): Promise<NativeDatabaseHealth>;
  getCurrentSession(): Promise<NativeSessionView | null>;
  authenticateUser(
    request: AuthenticateUserRequest,
  ): Promise<NativeSessionView>;
  logoutUser(): Promise<void>;
  listWidgets(organisationId: string): Promise<NativeWidgetRecord[]>;
  createWidget(request: CreateNativeWidgetRequest): Promise<NativeWidgetRecord>;
  createWidgets(
    request: CreateNativeWidgetsRequest,
  ): Promise<NativeWidgetRecord[]>;
  listOrganisations(): Promise<NativeOrganisationRecord[]>;
  createOrganisation(
    request: CreateNativeOrganisationRequest,
  ): Promise<NativeOrganisationRecord>;
}

export function createPlatformNativeGateway(
  invoker: NativeInvoker,
): PlatformNativeGateway {
  return {
    getDeviceIdentity: () =>
      invoker.invoke<NativeDeviceIdentity>("get_device_identity"),
    getDatabaseHealth: () =>
      invoker.invoke<NativeDatabaseHealth>("get_database_health"),
    getCurrentSession: () =>
      invoker.invoke<NativeSessionView | null>("get_current_session"),
    authenticateUser: (request) =>
      invoker.invoke<NativeSessionView>("authenticate_user", { request }),
    logoutUser: () => invoker.invoke<void>("logout_user"),
    listWidgets: (organisationId) =>
      invoker.invoke<NativeWidgetRecord[]>("list_widgets", {
        request: { organisation_id: organisationId },
      }),
    createWidget: (request) =>
      invoker.invoke<NativeWidgetRecord>("create_widget", { request }),
    createWidgets: (request) =>
      invoker.invoke<NativeWidgetRecord[]>("create_widgets", { request }),
    listOrganisations: () =>
      invoker.invoke<NativeOrganisationRecord[]>("list_organisations"),
    createOrganisation: (request) =>
      invoker.invoke<NativeOrganisationRecord>("create_organisation", {
        request,
      }),
  };
}
