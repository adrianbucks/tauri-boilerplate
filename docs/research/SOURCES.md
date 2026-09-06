# Research Sources

These are the official sources used for the current documentation baseline. Re-check version-sensitive pages when implementation begins.

## Tauri

- Security overview: https://v2.tauri.app/security/
- Permissions: https://v2.tauri.app/security/permissions/
- Capabilities: https://v2.tauri.app/reference/acl/capability/

## iroh

- Introduction: https://docs.iroh.computer/
- Endpoints: https://docs.iroh.computer/concepts/endpoints
- QUIC: https://docs.iroh.computer/protocols/using-quic
- Relays: https://docs.iroh.computer/concepts/relays
- Dedicated relays: https://docs.iroh.computer/add-a-relay
- Documents: https://docs.iroh.computer/protocols/documents
- Blobs: https://docs.iroh.computer/protocols/blobs

## SQLite

- Documentation index: https://www.sqlite.org/docs.html
- Foreign keys: https://www.sqlite.org/foreignkeys.html
- Transactions: https://sqlite.org/lang_transaction.html
- WAL: https://www.sqlite.org/wal.html

## Android / Apple background execution

- Android persistent work: https://developer.android.com/develop/background-work/background-tasks/persistent
- Android WorkManager API: https://developer.android.com/reference/androidx/work/WorkManager.html
- Apple BackgroundTasks: https://developer.apple.com/documentation/BackgroundTasks
- Apple BGProcessingTaskRequest: https://developer.apple.com/documentation/backgroundtasks/bgprocessingtaskrequest

## Security

- OWASP MASVS Storage: https://mas.owasp.org/MASVS/05-MASVS-STORAGE/
- OWASP MASVS-STORAGE-1: https://mas.owasp.org/MASVS/controls/MASVS-STORAGE-1/

## TypeScript / monorepo

- Project references: https://www.typescriptlang.org/docs/handbook/project-references
- TSConfig references: https://www.typescriptlang.org/tsconfig/references.html
- Module resolution/reference guidance: https://www.typescriptlang.org/docs/handbook/modules/reference

## Node.js

- Release schedule: https://nodejs.org/en/about/previous-releases
- EOL policy: https://nodejs.org/en/about/eol

## Evidence notes

As of the 2026-09-05 baseline, Node 24 is LTS and Node 20 is EOL. iroh documentation states that endpoints use encrypted/authenticated QUIC connections, relay fallback is supported, and public relays are intended for development/hobby use rather than production. Android recommends WorkManager for persistent background work. Tauri documents capabilities/permissions as the mechanism for restricting webview access to commands.
