import {
  BaseRepository,
  type DatabaseConnection,
  type TransactionClient,
} from "@platform/database";
import type { NoteRecord } from "./NotesTypes.js";

export class NotesRepository extends BaseRepository<NoteRecord> {
  protected readonly tableName = "notes";
  protected override readonly supportsSoftDelete = true;

  constructor(db: DatabaseConnection) {
    super(db);
  }

  private mapRow(row: Record<string, unknown> | null | undefined): NoteRecord | null {
    if (!row) return null;
    return {
      id: String(row.id),
      createdAt: String(row.created_at ?? row.createdAt),
      updatedAt: String(row.updated_at ?? row.updatedAt),
      organisationId: String(row.organisation_id ?? row.organisationId),
      syncGroupId: String(row.sync_group_id ?? row.syncGroupId),
      title: String(row.title),
      content: String(row.content),
      authorId: String(row.author_id ?? row.authorId),
      deletedAt: (row.deleted_at ?? row.deletedAt ?? null) as string | null,
      deletedBy: (row.deleted_by ?? row.deletedBy ?? null) as string | null,
      deleteOperationId: (row.delete_operation_id ?? row.deleteOperationId ?? null) as
        string | null,
    };
  }

  override async findById(id: string, tx?: TransactionClient): Promise<NoteRecord | null> {
    const raw = await super.findById(id, tx);
    return this.mapRow(raw as unknown as Record<string, unknown>);
  }

  async findBySyncGroup(
    syncGroupId: string,
    organisationId: string,
    tx?: TransactionClient,
  ): Promise<NoteRecord[]> {
    const executor = this.getExecutor(tx);
    const sql = `SELECT * FROM notes WHERE sync_group_id = ? AND organisation_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`;
    const rows = await executor.query<Record<string, unknown>>(sql, [syncGroupId, organisationId]);
    return rows.map((r) => this.mapRow(r)!);
  }

  async findAllWithinOrganisation(
    organisationId: string,
    deviceId: string,
    userId: string | null,
    tx?: TransactionClient,
  ): Promise<NoteRecord[]> {
    const executor = this.getExecutor(tx);
    const rows = await executor.query<Record<string, unknown>>(
      `SELECT * FROM notes n
       WHERE n.organisation_id = ? AND n.deleted_at IS NULL
         AND EXISTS (
           SELECT 1 FROM core_sync_groups g
           WHERE g.id = n.sync_group_id
             AND g.organisation_id = n.organisation_id
             AND g.status = 'ACTIVE'
         )
         AND EXISTS (
           SELECT 1
           FROM core_sync_group_members m
           INNER JOIN core_devices d ON d.device_id = m.device_id
           WHERE m.group_id = n.sync_group_id
             AND m.device_id = ?
             AND m.status IN ('APPROVED', 'ACTIVE')
             AND d.status IN ('APPROVED', 'ACTIVE')
             AND (m.user_id IS NULL OR m.user_id = ?)
         )
       ORDER BY n.created_at DESC`,
      [organisationId, deviceId, userId],
    );
    return rows.map((row) => this.mapRow(row)!);
  }

  async findByIdWithinOrganisation(
    id: string,
    organisationId: string,
    tx?: TransactionClient,
  ): Promise<NoteRecord | null> {
    const executor = this.getExecutor(tx);
    const sql = `SELECT * FROM notes WHERE id = ? AND organisation_id = ? AND deleted_at IS NULL LIMIT 1`;
    const rows = await executor.query<Record<string, unknown>>(sql, [id, organisationId]);
    return this.mapRow(rows[0]);
  }

  async softDeleteWithOperationId(
    id: string,
    deletedBy: string,
    deleteOperationId: string,
    deletedAt: string,
    tx: TransactionClient,
  ): Promise<void> {
    await this.getExecutor(tx).execute(
      `UPDATE notes
       SET deleted_at = ?, deleted_by = ?, delete_operation_id = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [deletedAt, deletedBy, deleteOperationId, id],
    );
  }
}
