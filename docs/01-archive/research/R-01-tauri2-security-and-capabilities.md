# R-01 --- Tauri 2 Security and Capabilities

## Question

How should the boilerplate expose native functionality without creating
a broad privileged frontend?

## Findings

Tauri 2 capabilities define which windows/webviews receive permissions.
Capability configuration is therefore a security boundary. Registered
commands should not be treated as inherently private, and capability
configuration does not compensate for insecure Rust code or weak scope
validation.

## Implications

- Expose application-level native commands, not generic OS primitives.
- Organise permissions around explicit responsibilities such as
  identity, secure storage, database maintenance, hardware and
  diagnostics.
- Require session, permission, tenant and input validation inside
  native commands where applicable.
- Review CSP exceptions and minimise permissive directives.
- Treat capability changes as security-sensitive release changes.

## Recommended direction

Retain Tauri 2 with a least-privilege command/capability model. Maintain
a machine-readable command-to-capability matrix and CI checks for broad
permissions.

## Sources

- https://v2.tauri.app/security/capabilities/
- https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/security/capabilities.mdx
- https://owasp.org/www-project-application-security-verification-standard/

## Research gate

Verify the exact capability syntax and command restrictions for the
pinned Tauri version before implementation.
