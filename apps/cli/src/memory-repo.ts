import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileMemoryRepository } from '@fca/memory-store';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Memory lives in ./memory/household-<id>.json (gitignored). HOUSEHOLD selects the household. */
export const memoryRepo = (): FileMemoryRepository =>
  new FileMemoryRepository(process.env['HOUSEHOLD'] ?? 'home', resolve(ROOT, 'memory'));
