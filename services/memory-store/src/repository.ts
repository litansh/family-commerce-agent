import type { HouseholdMemory } from '@fca/domain';

/**
 * Storage for one household's memory.
 *
 * A repository is bound to a single household when it is built, and the
 * household id comes from a verified identity — never from a request body.
 * Isolation is therefore a property of construction, not of remembering to
 * add a WHERE clause: there is no method that could read another household's
 * data, because the repository does not know another household exists.
 */
export interface MemoryRepository {
  readonly householdId: string;
  load(): Promise<HouseholdMemory>;
  /**
   * Optimistic write. Rejects with VersionConflict when the stored version is
   * not the one this memory was loaded from, so two family members editing at
   * once cannot silently overwrite each other.
   */
  save(memory: HouseholdMemory): Promise<HouseholdMemory>;
}

export class VersionConflict extends Error {
  constructor(householdId: string) {
    super(`Memory for household ${householdId} changed since it was loaded; reload and retry.`);
    this.name = 'VersionConflict';
  }
}

/** Bump the version on every save so conflicts are detectable. */
export const nextVersion = (m: HouseholdMemory): HouseholdMemory => ({
  ...m,
  version: m.version + 1,
});
