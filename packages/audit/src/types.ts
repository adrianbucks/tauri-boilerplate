export type AuditEventType =
  | "USER_CREATED"
  | "USER_UPDATED"
  | "USER_SUSPENDED"
  | "USER_REVOKED"
  | "ROLE_ASSIGNED"
  | "ROLE_REVOKED"
  | "DEVICE_REGISTERED"
  | "DEVICE_APPROVED"
  | "DEVICE_SUSPENDED"
  | "DEVICE_REVOKED"
  | "SYNC_GROUP_CREATED"
  | "SYNC_GROUP_UPDATED"
  | "SYNC_GROUP_MEMBER_ADDED"
  | "SYNC_GROUP_MEMBER_REMOVED"
  | "MEMBERSHIP_REQUESTED"
  | "MEMBERSHIP_APPROVED"
  | "MEMBERSHIP_REJECTED"
  | "ORGANISATION_CREATED"
  | "ORGANISATION_UPDATED"
  | "SESSION_ESTABLISHED"
  | "SESSION_INVALIDATED"
  | "IMPORT_STARTED"
  | "IMPORT_COMPLETED"
  | "IMPORT_FAILED"
  | "EXPORT_CREATED"
  | "RECORD_CREATED"
  | "RECORD_UPDATED"
  | "RECORD_DELETED"
  | "CONFLICT_DETECTED"
  | "CONFLICT_RESOLVED"
  | "REVOCATION_PROPAGATED"
  | "SECURITY_REJECTION";

export interface AuditEvent {
  readonly id: string;
  readonly eventType: AuditEventType;
  readonly userId: string | null;
  readonly deviceId: string;
  readonly organisationId: string;
  readonly correlationId: string;
  readonly timestamp: string;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface EmitAuditEventInput {
  readonly eventType: AuditEventType;
  readonly userId?: string | null | undefined;
  readonly deviceId: string;
  readonly organisationId: string;
  readonly correlationId: string;
  readonly metadata?: Record<string, unknown> | undefined;
}
