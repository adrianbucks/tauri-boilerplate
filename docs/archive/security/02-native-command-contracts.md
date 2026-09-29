# Native Command Contracts

Every Tauri command must document its caller, scope, authentication
requirement, validation, sensitivity, and audit requirement before it is
exposed to the webview.

**Current:** only `get_device_identity` is implemented. Additional commands
must be specified here before they are added. See [S-10](../specifications/S-10-tauri-native-capability-boundary.md).

## `get_device_identity`

- **Capability:** `identity.read`
- **Caller:** the application webview during platform bootstrap
- **Authentication:** pre-authentication bootstrap command
- **Scope:** the compiled application identifier only
- **Validation:** no caller-supplied application or platform identifiers
- **Output:** public `DeviceIdentity` fields only
- **Sensitive data:** private keys never cross the Rust boundary
- **Audit:** local bootstrap diagnostic; no credential material is logged

The application identifier is compiled into the native application. The
webview cannot select a different identity namespace.
