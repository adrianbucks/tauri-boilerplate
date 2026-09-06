import {
  BaseRepository,
  type DatabaseConnection,
  type TransactionClient,
} from "@platform/database";

export interface OrganisationRecord {
  id: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  name: string;
  domain: string | null;
  status: "ACTIVE" | "SUSPENDED" | "ARCHIVED";
  settings_json: string | null;
}

export class OrganisationRepository extends BaseRepository<OrganisationRecord> {
  protected readonly tableName = "core_organisations";

  constructor(db: DatabaseConnection) {
    super(db);
  }

  async findByDomain(
    domain: string,
    tx?: TransactionClient,
  ): Promise<OrganisationRecord | null> {
    const executor = this.getExecutor(tx);
    const sql = `SELECT * FROM core_organisations WHERE domain = ? LIMIT 1`;
    const rows = await executor.query<OrganisationRecord>(sql, [domain]);
    return rows[0] ?? null;
  }

  async findByIdWithinOrganisation(
    id: string,
    organisationId: string,
    tx?: TransactionClient,
  ): Promise<OrganisationRecord | null> {
    const executor = this.getExecutor(tx);
    const sql = `SELECT * FROM core_organisations WHERE id = ? AND id = ? LIMIT 1`;
    const rows = await executor.query<OrganisationRecord>(sql, [
      id,
      organisationId,
    ]);
    return rows[0] ?? null;
  }

  async findAllWithinOrganisation(
    organisationId: string,
    tx?: TransactionClient,
  ): Promise<OrganisationRecord[]> {
    const executor = this.getExecutor(tx);
    const sql = `SELECT * FROM core_organisations WHERE id = ? ORDER BY name ASC`;
    return executor.query<OrganisationRecord>(sql, [organisationId]);
  }
}
