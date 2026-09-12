/**
 * Live check of the price portals from this Mac: how many branches each chain
 * publishes, and what a small basket costs at the branches nearest a point.
 *   node --experimental-strip-types services/branch-prices/lab.mjs [lat lng city]
 */
import { allPortals, branchesInCity, fetchCbs, geocode, nearestBranches, parsePriceFull, parsePromoFull, decodeXml, priceAtBranch } from './src/index.ts';
import { DEFAULT_CONSTANTS } from '@fca/domain';
const [lat = '32.0853', lng = '34.7818', city = 'תל אביב'] = process.argv.slice(2);
const home = { lat: Number(lat), lng: Number(lng) };
const names = await fetchCbs(); console.log('cbs settlements:', Object.keys(names).length);
const geo = [];
for (const p of allPortals()) {
  const t0 = Date.now();
  try {
    const all = await p.stores();
    const inCity = branchesInCity(all, city, names);
    console.log(`${p.chain.padEnd(14)} branches ${String(all.length).padStart(4)}  in ${city}: ${inCity.length}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    for (const b of inCity.slice(0, 3)) {
      const cityName = /^\d+$/.test(b.city) ? names[b.city] ?? b.city : b.city;
      const g = await geocode(`${b.address}, ${cityName}`); await new Promise((r) => setTimeout(r, 1100));
      if (g) geo.push({ ...b, chain: p.chain, brand: p.brand, ...g }); else console.log(`   no geocode: ${b.name} | ${b.address}, ${cityName}`);
    }
  } catch (e) { console.log(`${p.chain.padEnd(14)} FAILED ${String(e).slice(0, 120)}`); }
}
const near = nearestBranches(geo, home, { radiusKm: 15, perChain: 1 });
console.log('\nnearest:', near.map((b) => `${b.brand} ${b.name} ${b.distanceKm}km`).join(' | '));
const lines = [{ id: 'milk', query: 'חלב', gtin: '7290004131074', qty: 2 }, { id: 'peas', query: 'אפונה', gtin: '7290000208114', qty: 1 }, { id: 'cottage', query: 'קוטג', gtin: '7290004127220', qty: 1 }, { id: 'treat', query: 'קינדר שוקולד', gtin: '80310167', qty: 1 }];
const portals = Object.fromEntries(allPortals().map((p) => [p.chain, p]));
for (const b of near) {
  const t0 = Date.now();
  try {
    const ref = await portals[b.chain].priceFile(b.storeId);
    if (!ref) { console.log(`${b.brand} ${b.name}: no price file`); continue; }
    const pf = parsePriceFull(decodeXml(await portals[b.chain].download(ref)));
    let promos; let promoCount = 0;
    try {
      const pref = await portals[b.chain].promoFile(b.storeId);
      if (pref) { promos = parsePromoFull(decodeXml(await portals[b.chain].download(pref))); promoCount = Object.keys(promos).length; }
    } catch (e) { console.log(`   promo fetch failed: ${String(e).slice(0, 100)}`); }
    const q = priceAtBranch(b, pf.prices, lines, DEFAULT_CONSTANTS, promos);
    const deals = q.quote.lines.filter((l) => l.lineTotal < l.unitPrice * l.qty).map((l) => `${l.query} deal ₪${(l.lineTotal / 100).toFixed(2)} vs regular ₪${((l.unitPrice * l.qty) / 100).toFixed(2)}${l.clubOnly ? ' (club)' : ''}`);
    console.log(`${b.brand} ${b.name} (${b.distanceKm} km): ${Object.keys(pf.prices).length} barcodes, ${promoCount} promos; basket ₪${(q.quote.itemsSubtotal / 100).toFixed(2)} for ${q.quote.pricedLines}/${lines.length} lines; drive ₪${(q.travel.fuelCost / 100).toFixed(0)} ~${q.travel.roundTripMinutes} min  (${((Date.now() - t0) / 1000).toFixed(1)}s)  ${q.quote.lines.map((l) => `${l.query}=${(l.unitPrice / 100).toFixed(2)}`).join(', ')}${deals.length ? `  [${deals.join(', ')}]` : ''}`);
  } catch (e) { console.log(`${b.brand} ${b.name}: FAILED ${String(e).slice(0, 120)}`); }
}
