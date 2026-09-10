/**
 * Retailer sessions.
 *
 * The family signs in to a retailer once, in a browser window the worker
 * opens on their own machine. The worker keeps the resulting session —
 * cookies and local storage, nothing else — encrypted on disk, and reuses it
 * until the retailer expires it. No password is ever seen, stored or sent
 * anywhere by Kaniti.
 *
 * Encryption is AES-256-GCM with a key that lives only in ~/.kaniti/key
 * (mode 0600). Losing the key means signing in again; nothing worse.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { BrowserContext } from 'playwright';

export type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

// New name, old home: keep using ~/.kanili where it already exists.
const DIR = existsSync(join(homedir(), '.kanili')) && !existsSync(join(homedir(), '.kaniti')) ? join(homedir(), '.kanili') : join(homedir(), '.kaniti');
const KEY_FILE = join(DIR, 'key');

function key(): Buffer {
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  if (!existsSync(KEY_FILE)) {
    writeFileSync(KEY_FILE, randomBytes(32));
    chmodSync(KEY_FILE, 0o600);
  }
  return readFileSync(KEY_FILE);
}

const sessionPath = (householdId: string, retailer: string): string =>
  join(DIR, `session-${householdId}-${retailer}.bin`);

export function hasSession(householdId: string, retailer: string): boolean {
  return existsSync(sessionPath(householdId, retailer));
}

/** Persist a context's cookies + storage, encrypted. */
export async function saveSession(householdId: string, retailer: string, ctx: BrowserContext): Promise<void> {
  const state = Buffer.from(JSON.stringify(await ctx.storageState()));
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(state), cipher.final()]);
  const p = sessionPath(householdId, retailer);
  writeFileSync(p, Buffer.concat([iv, cipher.getAuthTag(), enc]));
  chmodSync(p, 0o600);
}

/** Decrypt a saved session into the shape Playwright's newContext accepts. */
export function loadSession(householdId: string, retailer: string): StorageState {
  const buf = readFileSync(sessionPath(householdId, retailer));
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const d = createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(enc), d.final()]).toString()) as StorageState;
}
