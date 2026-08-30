import { ORGANISATION_PERMISSIONS } from "./permissions.js";
import type { FeatureManifest } from "@platform/feature-system";

export const organisationsManifest: FeatureManifest = {
  id: "organisations",
  name: "Organisations Management",
  version: "1.0.0",
  description:
    "Manages organisation tenancies, settings, and root domain entities.",
  dependencies: [],
  optionalDependencies: [],
  permissions: [
    {
      name: ORGANISATION_PERMISSIONS.READ,
      description: "View organisation details and tenancies",
    },
    {
      name: ORGANISATION_PERMISSIONS.CREATE,
      description: "Create new organisation tenancies",
    },
    {
      name: ORGANISATION_PERMISSIONS.MANAGE,
      description: "Manage organisation configuration and domains",
    },
  ],
  migrations: [], // Table core_organisations is part of platform base schema
  navigation: [
    {
      id: "nav-organisations",
      label: "Organisations",
      path: "/admin/organisations",
      icon: "building",
      requiredPermission: ORGANISATION_PERMISSIONS.MANAGE,
      order: 80,
    },
  ],
};
