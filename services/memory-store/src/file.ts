import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { emptyMemory, type HouseholdMemory } from '@fca/domain';
import { nextVersion, VersionConflict, type MemoryRepository } from './repository.ts';

/**
 * Local JSON file, one per household. For development and the CLI.
 *
 * The household id is part of the path, so a repository for h1 physically
 * cannot open h2's file — the same isolation-by-construction the DynamoDB
 * implementation gets from its partition key.
 */
export class FileMemoryRepository implements MemoryRepository {
  readonly householdId: string;
  readonly #path: string;

  constructor(householdId: string, dir: string) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(householdId)) {
      throw new RangeError(`Unsafe household id: ${householdId}`);
    }
    this.householdId = householdId;
    this.#path = join(dir, `household-${householdId}.json`);
  }

  async load(): Promise<HouseholdMemory> {
    try {
      const m = JSON.parse(await readFile(this.#path, 'utf8')) as HouseholdMemory;
      if (m.householdId !== this.householdId) {
        throw new Error(`File for ${this.householdId} contains memory for ${m.householdId}`);
      }
      return m;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return emptyMemory(this.householdId);
      throw e;
    }
  }

  async save(memory: HouseholdMemory): Promise<HouseholdMemory> {
    if (memory.householdId !== this.householdId) {
      throw new Error(`Refusing to save memory for ${memory.householdId} through a repository for ${this.householdId}`);
    }
    const current = await this.load();
    if (current.version !== memory.version) throw new VersionConflict(this.householdId);
    const next = nextVersion(memory);
    await mkdir(dirname(this.#path), { recursive: true });
    await writeFile(this.#path, JSON.stringify(next, null, 2), 'utf8');
    return next;
  }
}
