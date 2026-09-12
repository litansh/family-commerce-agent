/**
 * The branch-price refresher: a Lambda of its own (long timeout, more memory)
 * that reads the chains' daily price files for the branches near each household.
 * Invoked nightly by a schedule, and by the API when a household first asks.
 */
import { BranchPrices } from './branches.ts';
import { geocode } from '@fca/branch-prices';
import { RamiLevyStock } from '@fca/retailer-connectors';
import { readRow, writeRow } from './orders.ts';

const svc = new BranchPrices(process.env['TABLE_NAME'] ?? 'fca-main', process.env['BRANCH_BUCKET'] ?? '', '');

/**
 * Rami Levy's online branches, placed on the map once a night. The compare needs to know which
 * branch will fill a family's basket before their first order - Kfar Saba has no online branch of
 * its own, and the site's default branch is an hour away, which is how an out-of-stock line reaches
 * a family at the till. Geocoding is one request a second, so it belongs here, not in a quote.
 */
async function placeRamiLevyBranches(): Promise<number> {
  const list = await new RamiLevyStock(15_000).branches();
  if (!list.length) return 0;
  const prev = new Map<number, { lat?: number; lng?: number }>();
  const row = (await readRow(process.env['TABLE_NAME'] ?? 'fca-main', 'CATALOG', 'RL_BRANCHES')) as { branches?: { id: number; lat?: number; lng?: number }[] } | undefined;
  for (const b of row?.branches ?? []) prev.set(b.id, b);
  const placed = [];
  for (const b of list) {
    const had = prev.get(b.id);
    if (typeof had?.lat === 'number') { placed.push({ ...b, lat: had.lat, lng: had.lng }); continue; }
    const q = [b.street, b.houseNumber, b.city].filter(Boolean).join(' ');
    const at = q ? await geocode(`${q}, ישראל`).catch(() => undefined) : undefined;
    placed.push(at ? { ...b, lat: at.lat, lng: at.lng } : b);
    await new Promise((r) => setTimeout(r, 1100)); // Nominatim: one request a second
  }
  await writeRow(process.env['TABLE_NAME'] ?? 'fca-main', 'CATALOG', 'RL_BRANCHES', { branches: placed, at: new Date().toISOString() });
  return placed.filter((b) => typeof b.lat === 'number').length;
}

export async function handler(event: { hid?: string } | undefined): Promise<{ refreshed: string[] }> {
  if (event?.hid) {
    const row = await svc.refreshHousehold(event.hid);
    console.log(`refreshed ${event.hid}: ${row.status}, ${row.branches.length} branches`);
    return { refreshed: [event.hid] };
  }
  const placed = await placeRamiLevyBranches().catch((e: unknown) => { console.warn('rami-levy branches not placed', e instanceof Error ? e.message : String(e)); return 0; });
  console.log(`rami-levy online branches on the map: ${placed}`);
  const done = await svc.refreshAll();
  console.log(`nightly: ${done.length} households`);
  return { refreshed: done };
}
