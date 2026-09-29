# S-09 --- Frontend and Application Boundary

**Status:** Ready\
**Priority:** P1

## Objective

Make the demo a consumer of the platform.

## Ownership

### Platform

Infrastructure and reusable UI primitives.

### Features

Domain behaviour and schemas.

### Application

Application ID, branding, route tree, enabled features, startup and
application migrations.

## Target composition

```text
apps/demo
  bootstrap
  routes
  branding
  enabled features

packages/*
features/*
```

The exact composition API may evolve, but platform packages must not
depend on demo-specific route or branding state.

## Acceptance criterion

A second application can consume the platform without copying or
modifying demo internals.

## Implemented baseline

The demo bootstrap owns database initialization, demo schema setup, and
feature service construction. React pages consume typed services through
the platform context and no longer create database connections or query
SQLite directly.
