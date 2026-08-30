export const ORGANISATION_PERMISSIONS = {
  READ: "organisations.read",
  CREATE: "organisations.create",
  MANAGE: "organisations.manage",
} as const;

export type OrganisationPermission =
  (typeof ORGANISATION_PERMISSIONS)[keyof typeof ORGANISATION_PERMISSIONS];
