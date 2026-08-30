Detailed instructions and rules are maintained in [`docs/development/06-agent-and-developer-guidelines.md`](./docs/development/06-agent-and-developer-guidelines.md).

---

## 10 Critical Invariants for Agents

1. **Do not bypass the repository layer**: Never execute direct SQL queries or open raw connections in UI components or service classes.
2. **Do not hardcode role checks**: Never write `if (user.role === 'admin')`. Use `authorization.require('permission.name', resource)` or `authorization.can()`.
3. **Do not sync without a sync policy**: Any synchronisable entity must declare a valid `SyncPolicyDefinition` in its `FeatureManifest`.
4. **Do not transmit data before passing all 7 authorisation layers**: A peer being reachable does not mean it is authorised.
5. **Do not leak private keys**: Never expose private keys to the TypeScript runtime, web storage, or SQLite.
6. **Do not use raw DELETE for synchronisable entities**: Always use the tombstone pattern (`deleted_at`, `deleted_by`, `delete_operation_id`).
7. **Do not guess evolving APIs**: For Tauri, iroh, Drizzle, and TanStack, consult current official documentation and write proof-of-concept spikes rather than assuming API shapes.
8. **Do not grant broad Tauri capabilities**: Every capability in `capabilities/*.json` must be scoped narrowly and commented with its justification.
9. **Add security regression tests**: Every security change must be accompanied by a test in `tests/security/`.
10. **Maintain the boilerplate/implementation boundary**: Do not add domain-specific business logic into `packages/` or `crates/`. Keep all domain logic in `features/` or `apps/`.
