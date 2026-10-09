/**
 * DeclarativePruningPolicy
 *
 * Defines the contract for time-based data retention policies registered by
 * features and platform subsystems.
 */

export interface DeclarativePruningPolicy {
  id: string;
  displayName: string;
  description?: string | undefined;
  tableName: string;
  timestampColumn: string;
  defaultRetentionDays: number;
  /** Optional SQL filter, e.g. "status = 'PROCESSED'" */
  filterCondition?: string | undefined;
}
