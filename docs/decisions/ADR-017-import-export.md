# ADR-017: Spreadsheet Ingestion and Export Engine

## Status

Accepted

## Context

Local-first industrial, warehousing, and enterprise operations require bulk data ingestion from customer spreadsheets (inventory items, location mappings, product catalogs) and reliable spreadsheet export capabilities.

Key constraints:

1. Support for both modern `.xlsx` and legacy/CSV formats.
2. Ingestion must run locally without external cloud dependency.
3. Row-level validation and error reporting with line-number precision.
4. Transactional commits ensuring partial corruptions do not pollute SQLite.
5. Emitting audit events (`IMPORT_COMPLETED`, `IMPORT_FAILED`) atomically.

## Decision

We adopt **SheetJS CE (`xlsx`)** wrapped inside `@platform/import-export`:

1. `ImportEngine` validates headers against typed `ImportDefinition`, performs row-level schema transformation, and delegates commit to repository transactions.
2. `ExportEngine` converts entity collections to CSV text and binary `.xlsx` buffers for native file download/saving.

## Consequences

- **Pros**: Pure local execution, zero cloud latency, zero external data leakage, universal Excel compatibility.
- **Cons**: Large multi-megabyte files (100k+ rows) must be streamed or batched to prevent main-thread latency.
