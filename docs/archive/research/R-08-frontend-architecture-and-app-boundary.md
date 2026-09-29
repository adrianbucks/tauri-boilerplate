# R-08 --- Frontend Architecture and Application Boundary

## Current issue

The demo application contains hardcoded routes, branding and platform
construction. This makes the demo too influential over the reusable
platform.

## Recommended boundary

### Platform

Database, identity, authorization, sync, feature registry, native
adapters and reusable UI primitives.

### Features

Domain behaviour and domain schemas.

### Application

Application ID, branding, route tree, enabled features, startup
configuration and application-specific migrations.

The demo should be a consumer of these capabilities and should be
replaceable without changing platform packages.

## Sources

- https://react.dev/
- https://v2.tauri.app/

## Research gate

Validate the current routing/composition approach against the versions
actually pinned by the application.
