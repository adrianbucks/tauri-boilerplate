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
      deleteOperationId: (row.delete_operation_id ?? row.deleteOperationId ?? null) as string | null,
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

  async findByIdWithinOrganisation(
    id: string,
    organisationId: string,
    tx?: TransactionClient,
  ): Promise<NoteRecord | null> {
    const executor = this.getExecutor(tx);
    const sql = `SELECT * FROM notes WHERE id = ? AND organisation_id = ? LIMIT 1`;
    const rows = await executor.query<Record<string, unknown>>(sql, [id, organisationId]);
    return this.mapRow(rows[0]);
  }
}
