/**
 * Conservative SQL-literal redactor used when DataSource.redactSqlText is
 * true. Scrubs `'…'` and `N'…'` payloads. Not a full SQL parser — good
 * enough to reduce PII leakage in audit messages without being lossy for
 * structural identifiers (table names, column names, etc.).
 *
 * Phase 2 mappers (queryStore, spExec) reuse this. Phase 1 job-history.ts
 * keeps its inline copy intentionally — additive change, no edit to shipped
 * code paths.
 */
export function redactSqlLiterals(s: string): string {
  if (!s) return s;
  return s
    .replace(/N'([^']|'')*'/g, "N'…'")
    .replace(/'([^']|'')*'/g, "'…'");
}
