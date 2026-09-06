# Frontend and Downstream Application Integration Plan

## Principle

The boilerplate must not dictate the frontend of consuming applications.

The current demo frontend is a reference implementation and should be
treated as replaceable.

## 1. Platform frontend contract

Expose optional reusable UI infrastructure:

- buttons;
- cards;
- tables;
- forms;
- dialogs;
- notifications;
- loading/error states;
- permission-aware UI helpers;
- theme provider;
- optional AppShell;
- optional DataTable;
- optional diagnostics views.

## 2. Application owns composition

A consuming application should be able to implement:

```text
apps/my-app/src/
  App.tsx
  routes/
  pages/
  components/
  layouts/
  hooks/
  styles/
```

without changing platform packages.

## 3. No mandatory AppShell

The platform AppShell should be an optional reference shell.

Provide primitives rather than requiring:

```text
<AppShell>
```

for every application.

## 4. Routing

The platform should not force one routing library unless there is a
strong reason.

A route contribution API may be provided, but applications should be
able to use their preferred router.

## 5. Platform hooks

Examples:

```ts
useCurrentUser();
useCurrentDevice();
useAuthorization();
useSyncStatus();
useDiagnostics();
useFeatureRegistry();
```

These should be thin adapters over platform services.

## 6. Permission-aware UI

UI checks are convenience only.

Security must remain in services/platform authorization.

```text
UI permission check
       ↓
UX decision

Service authorization
       ↓
Security decision
```

## 7. Branding

Downstream applications should define:

- name;
- logo;
- favicon;
- theme;
- typography;
- colours;
- application metadata.

Do not bake demo branding into platform components.

## 8. Demo application role

The demo should demonstrate:

- bootstrapping;
- platform services;
- feature registration;
- database access;
- authorisation;
- sync diagnostics;
- native commands.

It should not become a hidden dependency for the platform.

## 9. Adoption test

Create a minimal `apps/template-consumer` test fixture that:

- replaces the demo frontend;
- adds an application table;
- adds one application feature;
- adds an application migration;
- registers a permission;
- uses a platform service;
- builds without modifying platform source.

This becomes the definitive proof that the boilerplate boundary works.
