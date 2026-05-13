/**
 * DataSource secret encryption (AES-256-GCM).
 *
 * Used to encrypt the password / token / Kerberos keytab stored on
 * `DataSource.encryptedSecret`. The plaintext NEVER touches Prisma logs,
 * the DB, or the audit table.
 *
 * Layout of the ciphertext blob written to Postgres `bytea`:
 *
 *   [ version : 1 byte ][ iv : 12 bytes ][ authTag : 16 bytes ][ ciphertext : N bytes ]
 *
 * Versioning is reserved for future key-rotation / algorithm changes.
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "crypto";

const ALGO = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION_BYTE = 0x01;

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.PMS_DSN_KEY;
  if (!raw) {
    throw new Error(
      "PMS_DSN_KEY is not set. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }

  // Accept base64 or hex.
  let buf: Buffer;
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length === KEY_BYTES * 2) {
    buf = Buffer.from(raw, "hex");
  } else {
    buf = Buffer.from(raw, "base64");
  }

  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `PMS_DSN_KEY must decode to ${KEY_BYTES} bytes (got ${buf.length}). Use a base64 or hex 32-byte key.`,
    );
  }

  cachedKey = buf;
  return buf;
}

/**
 * Encrypt a UTF-8 secret. Returns the wire-format Buffer suitable for
 * direct storage on a Prisma `Bytes` column.
 */
export function encryptSecret(plaintext: string): Buffer {
  if (typeof plaintext !== "string") {
    throw new TypeError("encryptSecret: plaintext must be a string");
  }

  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);

  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  if (tag.length !== TAG_BYTES) {
    // Defensive: GCM tag is fixed 16 bytes for our config.
    throw new Error(`encryptSecret: unexpected auth tag length ${tag.length}`);
  }

  return Buffer.concat([Buffer.from([VERSION_BYTE]), iv, tag, enc]);
}

/**
 * Decrypt a previously-encrypted blob. Throws on tamper / wrong key.
 * Accepts either a Node Buffer or a Uint8Array (Prisma may surface either).
 */
export function decryptSecret(blob: Buffer | Uint8Array | null | undefined): string {
  if (!blob) {
    throw new Error("decryptSecret: blob is null/undefined");
  }

  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);

  if (buf.length < 1 + IV_BYTES + TAG_BYTES + 1) {
    throw new Error("decryptSecret: blob too short to be a valid ciphertext");
  }

  const version = buf[0];
  if (version !== VERSION_BYTE) {
    throw new Error(
      `decryptSecret: unsupported version byte 0x${version.toString(16)} (expected 0x${VERSION_BYTE.toString(16)})`,
    );
  }

  const iv = buf.subarray(1, 1 + IV_BYTES);
  const tag = buf.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(1 + IV_BYTES + TAG_BYTES);

  const key = loadKey();
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);

  try {
    const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return dec.toString("utf8");
  } catch (err) {
    // Don't leak details — could be wrong key, tampered blob, or rotated key.
    throw new Error("decryptSecret: failed to decrypt (wrong key or corrupted blob)");
  }
}

/**
 * Constant-time equality for short secrets (e.g. comparing API tokens).
 * Not strictly part of DSN encryption but lives next to it because every
 * caller of this module already has the crypto module loaded.
 */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verify the env var is loadable. Useful in app startup to fail fast
 * rather than at the first encrypt() call.
 */
export function assertDsnKeyLoadable(): void {
  loadKey();
}
