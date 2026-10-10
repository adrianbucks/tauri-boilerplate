import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../");

describe("Security Regression Suite — Native Sync Transport Bounds", () => {
  it("keeps native sync frames size-bounded and stream reads time-limited", () => {
    const endpoint = fs.readFileSync(
      path.join(workspaceRoot, "crates/sync-core/src/endpoint.rs"),
      "utf8",
    );

    expect(endpoint).toContain("const MAX_ENVELOPE_SIZE: usize = 10 * 1024 * 1024;");
    expect(endpoint).toContain("const INBOUND_QUEUE_CAPACITY: usize = 8;");
    expect(endpoint).toContain("const MAX_IN_FLIGHT_STREAMS: usize = 4;");
    expect(endpoint).toContain("mpsc::channel(INBOUND_QUEUE_CAPACITY)");
    expect(endpoint).toContain("Semaphore::new(MAX_IN_FLIGHT_STREAMS)");
    expect(endpoint).toContain("acquire_owned().await");
    expect(endpoint.indexOf("acquire_owned().await")).toBeLessThan(
      endpoint.indexOf("let mut buf = vec![0u8; len];"),
    );
    expect(endpoint).toContain("const STREAM_READ_TIMEOUT: Duration = Duration::from_secs(30);");
    expect(endpoint).toContain("const STREAM_WRITE_TIMEOUT: Duration = Duration::from_secs(30);");
    expect(endpoint).toContain("const STREAM_ACK_TIMEOUT: Duration = Duration::from_secs(30);");
    expect(endpoint).toContain("timeout(STREAM_WRITE_TIMEOUT, send_stream.write_all(");
    expect(endpoint).toContain("timeout(STREAM_ACK_TIMEOUT, recv_stream.read_exact(");
    expect(endpoint).toContain("let len = frame_length(bytes.len())?;");
    expect(endpoint).toContain("frame_length(MAX_ENVELOPE_SIZE + 1)");
    expect(endpoint).toContain(
      "sender_clone\n                        .send(InboundEnvelopeMessage",
    );
    expect(endpoint.indexOf(".send(InboundEnvelopeMessage")).toBeLessThan(
      endpoint.indexOf("send_stream.write_all(&[1u8])"),
    );
  });

  it("removes closed connections without deleting a replacement connection", () => {
    const endpoint = fs.readFileSync(
      path.join(workspaceRoot, "crates/sync-core/src/endpoint.rs"),
      "utf8",
    );

    expect(endpoint).toContain("let _close_reason = conn.closed().await;");
    expect(endpoint).toContain("current.stable_id() == stable_id");
    expect(endpoint).toContain("connections.remove(&endpoint_id)");
  });

  it("exposes and invokes endpoint shutdown so listeners do not outlive transport owners", () => {
    const endpoint = fs.readFileSync(
      path.join(workspaceRoot, "crates/sync-core/src/endpoint.rs"),
      "utf8",
    );
    const nativeApp = fs.readFileSync(
      path.join(workspaceRoot, "apps/demo/src-tauri/src/lib.rs"),
      "utf8",
    );
    const transport = fs.readFileSync(
      path.join(workspaceRoot, "packages/sync/src/transport/IrohSyncTransport.ts"),
      "utf8",
    );

    expect(endpoint).toContain("pub async fn shutdown(&self)");
    expect(endpoint).toContain("self.endpoint.close().await");
    expect(nativeApp).toContain("async fn sync_stop_endpoint(");
    expect(nativeApp).toContain("sync_stop_endpoint,");
    expect(transport).toContain('await this.invoke("sync_stop_endpoint")');
  });

  it("validates outbox inputs before reaching SQLite", () => {
    const outbox = fs.readFileSync(
      path.join(workspaceRoot, "packages/sync/src/outbox/OutboxService.ts"),
      "utf8",
    );

    expect(outbox).toContain("export const MAX_OUTBOX_BATCH_SIZE = 50;");
    expect(outbox).toContain(
      "!Number.isSafeInteger(limit) || limit <= 0 || limit > MAX_OUTBOX_BATCH_SIZE",
    );
    expect(outbox.indexOf("if (!Number.isSafeInteger(limit)")).toBeLessThan(
      outbox.indexOf("const rows = await this.db.query"),
    );
    expect(outbox).toContain("!Number.isSafeInteger(maxAttempts) || maxAttempts <= 0");
    expect(outbox.indexOf("if (!Number.isSafeInteger(maxAttempts)")).toBeLessThan(
      outbox.indexOf("const now = getUtcIsoTimestamp();", outbox.indexOf("async markFailed(")),
    );
    expect(outbox.match(/WHERE envelope_id = \? AND status = 'PENDING'/g)).toHaveLength(2);
    expect(outbox).toContain("SyncEnvelopeBuilder.validateEnvelope(envelope)");
    expect(outbox).toContain("envelope_id, envelope_json, organisation_id");
    expect(outbox).toContain('typeof row.envelope_json !== "string"');
    expect(outbox.indexOf("SyncEnvelopeBuilder.validateEnvelope(envelope)")).toBeLessThan(
      outbox.indexOf("`INSERT INTO core_sync_outbox"),
    );
  });

  it("scopes outbox batch dispatch to the task's organisation", () => {
    const outbox = fs.readFileSync(
      path.join(workspaceRoot, "packages/sync/src/outbox/OutboxService.ts"),
      "utf8",
    );
    const worker = fs.readFileSync(
      path.join(workspaceRoot, "packages/tasks/src/sync/OutboxSyncWorker.ts"),
      "utf8",
    );

    expect(outbox).toContain("status = 'PENDING' AND organisation_id = ?");
    expect(worker).toContain("organisationId !== ctx.organisationId");
    expect(worker).toContain("pendingBatch(organisationId, batchLimit)");
  });

  it("validates persisted envelope identity and tenant metadata before dispatch", () => {
    const outbox = fs.readFileSync(
      path.join(workspaceRoot, "packages/sync/src/outbox/OutboxService.ts"),
      "utf8",
    );

    expect(outbox).toContain("SyncEnvelopeBuilder.validateEnvelope(envelope)");
    expect(outbox).toContain("operation.organisationId !== row.organisation_id");
    expect(outbox).toContain("envelope.envelopeId !== row.envelope_id");
    expect(outbox).toContain("Persisted sync envelope does not match its outbox metadata");
  });
});
