/**
 * Some chains publish a branch's city as its Central Bureau of Statistics
 * settlement code (3000 = ירושלים) rather than a name. The list of codes is
 * open data; it changes once in a blue moon, so callers cache the parsed map.
 */
export const CBS_URL = 'https://data.gov.il/api/3/action/datastore_search?resource_id=5c78e9fa-c2e2-4771-93ff-7f400a12f7ba&limit=5000';

export type SettlementNames = Record<string, string>;

export function parseCbs(payload: unknown): SettlementNames {
  const records = ((payload as { result?: { records?: Record<string, unknown>[] } })?.result?.records) ?? [];
  const out: SettlementNames = {};
  for (const r of records) {
    const code = String(r['סמל_ישוב'] ?? '').trim();
    const name = String(r['שם_ישוב'] ?? '').trim();
    if (code && name) out[code] = name;
  }
  return out;
}

export async function fetchCbs(fetchImpl: typeof fetch = fetch): Promise<SettlementNames> {
  const res = await fetchImpl(CBS_URL, { headers: { accept: 'application/json' } }).catch(() => null);
  if (!res?.ok) return {};
  return parseCbs(await res.json().catch(() => ({})));
}

/** "תל אביב -יפו", "תל-אביב", "תל אביב יפו" → "תל אביב יפו"; a code stays a code. */
export function normCity(s: string): string {
  return s.replace(/["'׳״]/g, '').replace(/[-–]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Does a branch's published city (name or code) mean the household's city? */
export function sameCity(published: string, cityName: string, names: SettlementNames): boolean {
  const target = normCity(cityName);
  if (!target) return false;
  const p = /^\d+$/.test(published.trim()) ? (names[published.trim()] ?? '') : published;
  const n = normCity(p);
  if (!n) return false;
  // "תל אביב" is "תל אביב יפו"; "ראשון לציון" is not "ראש העין".
  return n === target || n.startsWith(target + ' ') || target.startsWith(n + ' ');
}
