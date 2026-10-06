/**
 * Sealing a store session for storage: AES-256-GCM under a key that lives
 * only in the API's environment (`SESSION_KEY`, 32 bytes, base64). A row in
 * the table is useless without the key; the key is useless without the row.
 *
 * The associated data binds the ciphertext to its household and store, so a
 * sealed session copied onto another household's row does not open.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function seal(plain: unknown, keyB64: string, aad: string): string {
  const key = keyOf(keyB64);
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([c.update(JSON.stringify(plain), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
}

export function open<T = unknown>(sealed: string, keyB64: string, aad: string): T {
  const key = keyOf(keyB64);
  const buf = Buffer.from(sealed, 'base64');
  const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  d.setAAD(Buffer.from(aad, 'utf8'));
  d.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8')) as T;
}

function keyOf(b64: string): Buffer {
  const k = Buffer.from(b64, 'base64');
  if (k.length !== 32) throw new Error('SESSION_KEY must be 32 bytes, base64');
  return k;
}

export const newKey = (): string => randomBytes(32).toString('base64');
