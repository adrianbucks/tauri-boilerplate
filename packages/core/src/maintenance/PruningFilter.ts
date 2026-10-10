/**
 * Declarative pruning filters are SQL fragments, so accept only a single
 * column comparison with a literal value. This preserves the intended simple
 * status/retention filters without permitting boolean clauses or statements.
 */
const SAFE_PRUNING_FILTER =
  /^[\t\n\r ]*[A-Za-z_][A-Za-z0-9_]*[\t\n\r ]*(?:(?:=|<>|!=|<=|>=|<|>)[\t\n\r ]*(?:'(?:''|[^'])*'|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?|TRUE|FALSE|NULL)|IS[\t\n\r ]+(?:NOT[\t\n\r ]+)?NULL)[\t\n\r ]*$/i;

export function isSafePruningFilterCondition(value: string): boolean {
  return value.length <= 512 && SAFE_PRUNING_FILTER.test(value);
}
