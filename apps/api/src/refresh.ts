/**
 * The branch-price refresher: a Lambda of its own (long timeout, more memory)
 * that reads the chains' daily price files for the branches near each household.
 * Invoked nightly by a schedule, and by the API when a household first asks.
 */
import { BranchPrices } from './branches.ts';

const svc = new BranchPrices(process.env['TABLE_NAME'] ?? 'fca-main', process.env['BRANCH_BUCKET'] ?? '', '');

export async function handler(event: { hid?: string } | undefined): Promise<{ refreshed: string[] }> {
  if (event?.hid) {
    const row = await svc.refreshHousehold(event.hid);
    console.log(`refreshed ${event.hid}: ${row.status}, ${row.branches.length} branches`);
    return { refreshed: [event.hid] };
  }
  const done = await svc.refreshAll();
  console.log(`nightly: ${done.length} households`);
  return { refreshed: done };
}
