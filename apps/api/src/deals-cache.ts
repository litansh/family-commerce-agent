/**
 * When /deals pulls the provider's promotions again instead of reading CATALOG#PROMOS.
 *
 * A full cache (three chains or more) lives six hours. A thin one (fewer than three chains) is
 * pulled again sooner, since only a fresh pull can widen it, but not on every request: one pull is
 * 200 promotions and up to 120 catalogue searches to name them, and on 2026-10-04 the provider's
 * feed was 200/200 Wolt Market, so every visit to מבצעים re-pulled, re-searched, and stayed one
 * chain - load on a provider that was already answering "service_busy" to the compares.
 */
export const PROMOS_FULL_MS = 6 * 3600_000;
export const PROMOS_THIN_MS = 30 * 60_000;

export function shouldRepullPromos(count: number, chains: number, at: string | undefined, now: number): boolean {
  if (count === 0 || !at) return true;
  const age = now - Date.parse(at);
  if (!Number.isFinite(age)) return true;
  return age > (chains < 3 ? PROMOS_THIN_MS : PROMOS_FULL_MS);
}
