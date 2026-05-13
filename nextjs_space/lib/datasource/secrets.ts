/**
 * DataSource secret helpers.
 *
 * The only place in the codebase that turns a Prisma `DataSource` row
 * (with an opaque `encryptedSecret: Bytes`) into a usable connection
 * descriptor with a plaintext password. Connectors call this; nothing
 * else should.
 *
 * Keeping this in its own module makes it trivial to:
 *   - audit every call site that decrypts secrets,
 *   - centralise the redaction rules used in logs / errors,
 *   - swap the underlying KMS implementation later without touching
 *     connector code.
 */

import type { DataSource } from "@prisma/client";
import { decryptSecret, encryptSecret } from "../crypto/dsn";

export interface DecryptedDataSource {
  id: string;
  name: string;
  kind: DataSource["kind"];
  host: string;
  port: number;
  database: string;
  authMode: DataSource["authMode"];
  username: string | null;
  /** Plaintext password / token. May be empty for WINDOWS_AUTH / IAM. */
  password: string | null;
  trustServerCert: boolean;
  connectionParams: Record<string, unknown>;
}

/**
 * Decrypt a DataSource row into a connection descriptor.
 * The returned object's `password` field MUST NOT be logged.
 */
export function decryptDataSource(ds: DataSource): DecryptedDataSource {
  const password =
    ds.encryptedSecret && ds.encryptedSecret.length > 0
      ? decryptSecret(ds.encryptedSecret as Buffer)
      : null;

  return {
    id: ds.id,
    name: ds.name,
    kind: ds.kind,
    host: ds.host,
    port: ds.port,
    database: ds.database,
    authMode: ds.authMode,
    username: ds.username ?? null,
    password,
    trustServerCert: ds.trustServerCert,
    connectionParams: (ds.connectionParams as Record<string, unknown> | null) ?? {},
  };
}

/**
 * Encrypt a plaintext secret for storage on `DataSource.encryptedSecret`.
 * Empty / null inputs return null — callers can pass straight through to Prisma.
 */
export function encryptDataSourceSecret(plaintext: string | null | undefined): Buffer | null {
  if (!plaintext) return null;
  return encryptSecret(plaintext);
}

/**
 * Produce a redacted, log-safe view of a DataSource. Use in audit entries,
 * console.log, error messages — anywhere a row might surface to operators.
 */
export function redactForLog(ds: Pick<DataSource, "id" | "name" | "kind" | "host" | "port" | "database" | "authMode" | "username">): Record<string, unknown> {
  return {
    id: ds.id,
    name: ds.name,
    kind: ds.kind,
    host: ds.host,
    port: ds.port,
    database: ds.database,
    authMode: ds.authMode,
    username: ds.username ? maskUsername(ds.username) : null,
    password: "[redacted]",
  };
}

function maskUsername(u: string): string {
  if (u.length <= 2) return "*".repeat(u.length);
  return `${u[0]}${"*".repeat(Math.min(6, u.length - 2))}${u[u.length - 1]}`;
}
