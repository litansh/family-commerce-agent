import type { Agorot, TravelCost } from '@fca/domain';

export interface LatLng { readonly lat: number; readonly lng: number }

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Roads are not straight lines: the usual urban detour factor. */
export const ROAD_FACTOR = 1.3;
/** Door to door in an Israeli city, parking included, on average. */
export const URBAN_KMH = 25;

/** What a round trip to a branch costs, in money and in minutes (driving only; the shopping itself is not counted). */
export function travelTo(distanceKm: number, constants: { costPerKm: Agorot; parkingCost: Agorot }): TravelCost {
  const roadKm = Math.round(distanceKm * ROAD_FACTOR * 10) / 10;
  const roundTripKm = roadKm * 2;
  return {
    distanceKm: roadKm,
    roundTripMinutes: Math.max(4, Math.round((roundTripKm / URBAN_KMH) * 60)),
    fuelCost: Math.round(roundTripKm * constants.costPerKm) as Agorot,
    parkingCost: constants.parkingCost,
  };
}

/** Street-level geocoding through OpenStreetMap's Nominatim, as the address screen already does. One request a second is their rule. */
export async function geocode(query: string, fetchImpl: typeof fetch = fetch): Promise<LatLng | undefined> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=il&accept-language=he&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetchImpl(url, { headers: { 'user-agent': 'kaniti/0.1 (contact: litansh@gmail.com)' } }).catch(() => null);
  if (!res?.ok) return undefined;
  const rows = (await res.json().catch(() => [])) as { lat?: string; lon?: string }[];
  const r = rows[0];
  if (!r?.lat || !r.lon) return undefined;
  return { lat: Number(r.lat), lng: Number(r.lon) };
}
