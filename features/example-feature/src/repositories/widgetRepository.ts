import {
  BaseRepository,
  type DatabaseConnection,
  type TransactionClient,
} from "@platform/database";
import type { WidgetRecord } from "../schema/widgets.js";

export class WidgetRepository extends BaseRepository<WidgetRecord> {
  protected readonly tableName = "widgets";
  protected override readonly supportsSoftDelete = true;

  constructor(db: DatabaseConnection) {
    super(db);
  }

  private toWidgetRecord(row: Record<string, unknown>): WidgetRecord {
    return Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase()),
        value,
      ]),
    ) as WidgetRecord;
  }

  async findBySku(
    sku: string,
    organisationId: string,
    tx?: TransactionClient,
  ): Promise<WidgetRecord | null> {
    const executor = this.getExecutor(tx);
    const sql = `SELECT * FROM widgets WHERE sku = ? AND organisation_id = ? AND deleted_at IS NULL LIMIT 1`;
    const rows = await executor.query<WidgetRecord>(sql, [sku, organisationId]);
    return rows[0] ? this.toWidgetRecord(rows[0] as unknown as Record<string, unknown>) : null;
  }

  async findBySyncGroup(
    syncGroupId: string,
    organisationId: string,
    tx?: TransactionClient,
  ): Promise<WidgetRecord[]> {
    const executor = this.getExecutor(tx);
    const sql = `SELECT * FROM widgets WHERE sync_group_id = ? AND organisation_id = ? AND deleted_at IS NULL ORDER BY name ASC`;
    const rows = await executor.query<WidgetRecord>(sql, [syncGroupId, organisationId]);
    return rows.map((row) => this.toWidgetRecord(row as unknown as Record<string, unknown>));
  }

  async findByIdWithinOrganisation(
    id: string,
    organisationId: string,
    tx?: TransactionClient,
  ): Promise<WidgetRecord | null> {
    const executor = this.getExecutor(tx);
    const sql = `SELECT * FROM widgets WHERE id = ? AND organisation_id = ? AND deleted_at IS NULL LIMIT 1`;
    const rows = await executor.query<WidgetRecord>(sql, [id, organisationId]);
    return rows[0] ? this.toWidgetRecord(rows[0] as unknown as Record<string, unknown>) : null;
  }
}
