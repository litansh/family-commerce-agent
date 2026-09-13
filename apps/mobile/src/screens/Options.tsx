import React, { useEffect, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import type { PurchaseOption } from '@fca/domain';
import type { Api, Household, QuoteResult } from '../lib/api';
import { removeLine, type Line } from '../lib/store';
import { Button, Chip, Header, Loading, S, Skeleton, t } from '../ui';
import { ProductImage } from '../ProductImage';
import type { SearchHit } from '../lib/api';
import { isRTL, money, reasonT, t as tr } from '../lib/i18n';
import { markLinked, useLinked } from '../lib/linked';
import { addPending } from '../lib/pending';
import { getMode, setMode } from '../lib/prefs';
import { productAt } from '../lib/quote';
import { etaRank, etaTone, exceptionsOf, opensAt, rowsFor, savingOf, type CompareLike, type CompareRow } from '../lib/compare';
import { StoreLink } from './StoreLink';
import { storeForStorefront, type CartLine } from '../lib/stores';
import { OrderOnDevice } from './OrderOnDevice';
import { Platform } from 'react-native';

/**
 * The costed ways to buy the list. Cash is the headline; time cost is shown
 * separately and never merged. Anything a storefront cannot supply is named.
 */
const retailerOf = (storefrontId: string) => storeForStorefront(storefrontId)?.id;
/** What goes into the store's cart for one leg: barcode, name, quantity, and the deep link as the fallback. */
function cartLinesFor(leg: PurchaseOption['legs'][number], quote: QuoteResult): CartLine[] {
  return leg.lineIds.flatMap((id) => {
    const l = quote.lines.find((x) => x.id === id);
    if (!l) return [];
    // This store's own product and link for the line; the winner's resolution only as a fallback.
    const p = productAt(quote, leg.storefrontId, id);
    const gtin = p.gtin ?? l.gtin;
    return [{ ...(gtin ? { gtin } : {}), name: p.productName ?? l.query, qty: Math.max(1, Math.round(l.packQty ?? 1)), ...(p.link ? { link: p.link } : {}) }];
  });
}

/** Build order legs from an option: every leg the worker can drive. */
function legsFor(option: PurchaseOption, quote: QuoteResult) {
  const lineOf = (id: string) => quote.lines.find((l) => l.id === id);
  return option.legs.filter((leg) => retailerOf(leg.storefrontId) !== undefined).map((leg) => ({
    retailer: retailerOf(leg.storefrontId)!,
    lines: leg.lineIds.flatMap((id) => { const l = lineOf(id); const ql = quote.quotedLines[id]; return l ? [{ query: l.query, ...(ql?.gtin ? { gtin: ql.gtin } : l.gtin ? { gtin: l.gtin } : {}), ...(l.brand ? { brand: l.brand } : {}), ...(l.amount !== undefined ? { amount: l.amount } : {}), ...(l.unit ? { unit: l.unit } : {}), ...(l.packQty !== undefined ? { packQty: l.packQty } : {}) }] : []; }),
  }));
}

/**
 * One store on the compare, ready to read: the row's facts from `lib/compare.ts`, and the Hebrew the
 * screen wrapped around them. The facts and the words are kept apart on purpose — a rule written as a
 * regex over rendered Hebrew is a rule no lab can check (docs/design/compare-accuracy.md).
 */
type RowView = { view: CompareRow; title: string; when: string | null; whenTone: 'good' | 'neutral' | 'warn'; priceNote?: string; second: string };
type StoreLines = NonNullable<QuoteResult['storefrontLines']>[string];
/** Long product names, one line's worth. */
const short = (x: string) => (x.length > 28 ? x.slice(0, 27) + '…' : x);

/**
 * What a store actually priced, line by line (docs/design/item-identity.md): the family's own words
 * first, then the product that store put behind them. A line asked as "כל מותג" resolves to a
 * different product in every store — a 2 ℓ bottle here, a 1 ℓ bag there — and two totals are only
 * comparable when the screen says which. The family's words stay in ink so the list is still their
 * list; the store's product is the quiet half.
 */
function StoreLineList({ lines, storeLines, ids }: { lines: QuoteResult['lines']; storeLines: StoreLines; ids?: readonly string[] }) {
  const s = S();
  const shown = ids ? lines.filter((l) => ids.includes(l.id)) : lines;
  return (
    <>
      {shown.map((l) => {
        const x = storeLines[l.id];
        if (!x) return (
          <Text key={l.id} style={[s.small, { color: t.red, paddingVertical: 3 }]} numberOfLines={1}>{l.query} — {tr('missingHere')}</Text>
        );
        // A swap the store or Kaniti made is already a sentence with an arrow; it keeps its colour.
        const swapped = x.substituted;
        const said = swapped && x.reason && x.reason.includes('→') ? x.reason : x.productName;
        return (
          <Text key={l.id} style={[s.small, { paddingVertical: 3 }]} numberOfLines={2}>
            <Text style={{ color: t.ink }}>{l.query}</Text>
            <Text style={{ color: swapped ? t.amber : t.muted }}>{'  ·  '}{said}</Text>
          </Text>
        );
      })}
    </>
  );
}

/**
 * The price column of a row: the number with its note wrapping under it. Bounded so the name column
 * keeps its width; hugging the card's outer edge so the prices read as one column down the list.
 */
function PriceCol({ price, note, color }: { price: string; note?: string; color?: string }) {
  const s = S(); const rtl = isRTL();
  const edge = rtl ? ('left' as const) : ('right' as const);
  return (
    <View style={{ maxWidth: '45%', alignItems: rtl ? 'flex-start' : 'flex-end' }}>
      <Text style={[s.price, { fontSize: 18, color: color ?? t.ink, textAlign: edge }]}>{price}</Text>
      {note ? <Text style={[s.faint, { fontSize: 11, textAlign: edge }]}>{note}</Text> : null}
    </View>
  );
}

/**
 * A store row (docs/design/compare-screen.md): the same shape for an option and a rejected store.
 * Module-level on purpose: declared inside the screen it would be a new component type on every
 * render, remounting mid-tap. Tapping unfolds the store's lines and "buy here".
 */
function StoreRow({ row, open, onToggle, quote, onBuy }: {
  row: RowView; open: boolean; onToggle: () => void; quote: QuoteResult; onBuy: () => void;
}) {
  const s = S();
  const { view } = row;
  // A row whose number is not a delivered total is not the same kind of number as the answer's, and
  // must not read as one: it stays in muted ink and its note says what it covers (promise 4).
  const sid = view.storefrontId;
  const split = view.brands.length > 1;
  return (
    <Pressable onPress={onToggle} style={({ pressed }) => [{ paddingVertical: 10, borderTopWidth: 1, borderColor: t.line }, pressed ? { opacity: 0.7 } : null]} testID={`row-${sid}`}>
      <View style={[s.row, { gap: 10 }]}>
        <View style={{ flex: 1 }}>
          <View style={[s.rowStart, { gap: 6, flexWrap: 'wrap' }]}>
            <Text style={[s.body, { fontSize: 15, fontWeight: '600', flexShrink: 1 }]} numberOfLines={1}>{row.title}</Text>
            {row.when ? <Chip text={row.when} tone={row.whenTone} /> : null}
          </View>
          {row.second ? <Text style={[s.faint, { fontSize: 11, marginTop: 2 }]}>{row.second}</Text> : null}
        </View>
        <PriceCol price={money(view.price)} {...(row.priceNote ? { note: row.priceNote } : {})} color={view.deliveredTotal ? t.ink : t.muted} />
      </View>
      {open ? (
        <View style={{ marginTop: 8 }} testID={`row-${sid}-open`}>
          {/* Unfolded, a row explains itself the way the answer card does: for a split, each leg with
              its own brand, its own money and its own products — never the first leg's products under
              lines the second leg will buy. */}
          {split ? view.brands.map((b) => (
            <View key={b.storefrontId} style={{ marginTop: 4 }}>
              <View style={[s.row, { paddingVertical: 3 }]}>
                <Text style={s.small}>{b.brand}</Text>
                <Text style={s.priceSmall}>{money(b.itemsSubtotal)} + {money(b.deliveryFee)} {tr('delivery')}</Text>
              </View>
              <View style={{ paddingHorizontal: 8 }} testID={`row-lines-${b.storefrontId}`}>
                <StoreLineList lines={quote.lines} storeLines={quote.storefrontLines?.[b.storefrontId] ?? {}} ids={b.lineIds} />
              </View>
            </View>
          )) : <StoreLineList lines={quote.lines} storeLines={quote.storefrontLines?.[sid] ?? {}} />}
          <View style={{ marginTop: 8 }}><Button title={tr('buyHere')} kind="secondary" onPress={onBuy} testID={`buy-${sid}`} /></View>
        </View>
      ) : null}
    </Pressable>
  );
}

export function OptionsScreen({ api, household, lines, onBack, onChoose, onOrder }: {
  api: Api; household: Household; lines: Line[]; onBack: () => void; onChoose: (opt: PurchaseOption, q: QuoteResult) => void; onOrder: (orderId: string) => void;
}) {
  const [ordering, setOrdering] = useState(false);
  // A store you have never connected is connected right here, once, at the
  // moment you first order from it — never up front.
  const linked = useLinked();
  const [needLink, setNeedLink] = useState<{ retailer: string; best: PurchaseOption; q: QuoteResult } | null>(null);
  // On the phone the order runs here, in the store's own site, one store at a time (ADR 0008).
  const [onDevice, setOnDevice] = useState<{ storeId: string; lines: CartLine[]; rest: { storeId: string; lines: CartLine[] }[]; best: PurchaseOption; q: QuoteResult } | null>(null);
  const onDeviceDone = async (added: readonly CartLine[]) => {
    const cur = onDevice; if (!cur) return;
    // The cart is filled; the purchase is the store's checkout, which is the family's. Remember it as
    // pending: the Orders tab asks "did you buy it?" and only a yes teaches the memory. Then the next store.
    if (added.length) addPending(cur.storeId, added);
    if (cur.rest.length) setOnDevice({ ...cur.rest[0]!, rest: cur.rest.slice(1), best: cur.best, q: cur.q });
    else { setOnDevice(null); onChoose(cur.best, cur.q); }
  };
  const orderBest = async (bestIn: PurchaseOption, q: QuoteResult, { pinnable = true } = {}) => {
    let best = bestIn;
    // Driven simulator runs may pin the store the answer's order goes to (EXPO_PUBLIC_E2E_ORDER_STORE); inert
    // otherwise, and never for "buy here" on a row — a row that names a store opens that store (promises 1, 6).
    const pin = pinnable ? process.env['EXPO_PUBLIC_E2E_ORDER_STORE'] : undefined;
    if (pin) { const alt = q.options.find((o) => o.legs.length === 1 && retailerOf(o.legs[0]!.storefrontId) === pin); if (alt) best = alt; }
    const legs = legsFor(best, q);
    if (legs.length === 0) { onChoose(best, q); return; }
    if (Platform.OS !== 'web') {
      const plan = best.legs.map((leg) => ({ storeId: retailerOf(leg.storefrontId) ?? '', lines: cartLinesFor(leg, q) })).filter((x) => x.storeId && x.lines.length);
      if (plan.length) { setOnDevice({ ...plan[0]!, rest: plan.slice(1), best, q }); return; }
    }
    const missing = legs.find((l) => !linked.includes(l.retailer));
    if (missing) { setNeedLink({ retailer: missing.retailer, best, q }); return; }
    setOrdering(true);
    try { const o = await api.createOrder(household.id, legs); onOrder(o.id); }
    catch { onChoose(best, q); }
    finally { setOrdering(false); }
  };
  const s = S();
  const [q, setQ] = useState<QuoteResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fixing, setFixing] = useState<string | null>(null);
  // Cheap ↔ fast. "Fast" means one delivery from one store: nothing to wait
  // for twice, nothing to drive to. "Balanced" takes the one-store order when
  // it is within a few percent of the cheapest split, else the cheapest.
  const [strategy, setStrategyState] = useState<'cheap' | 'balanced' | 'fast'>(getMode());
  const setStrategy = (m: 'cheap' | 'balanced' | 'fast') => { setStrategyState(m); setMode(m); };
  // Which row (or the answer's legs) is unfolded.
  const [open, setOpen] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Past half a minute the loading copy says why it is taking longer, so nobody thinks it is stuck.
  const [slow, setSlow] = useState(false);
  useEffect(() => { setSlow(false); const timer = setTimeout(() => setSlow(true), 35_000); return () => clearTimeout(timer); }, [attempt, lines]);
  useEffect(() => {
    setErr(null);
    api.quote(household.id, lines.map(({ id: _i, imageUrl: _u, productName: _n, size: _s, ...l }) => l)).then(setQ).catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, [api, household.id, lines, attempt]);

  // A slow minute at the stores, a gateway page, a dropped network: one sentence and a retry. Nothing internal reaches the screen.
  if (err) return <View style={s.screen}><Header title={tr('wentWrong')} onBack={onBack} /><Text style={[s.body, s.pad, { color: t.red }]}>{/stores_slow|Service Unavailable|Gateway|HTTP 5\d\d|internal error|compare failed|Network request failed/i.test(err) ? tr('storesSlow') : err}</Text><View style={s.pad}><Button title={tr('tryAgain')} onPress={() => setAttempt((n) => n + 1)} /></View></View>;
  if (!q) return (
    <View style={s.screen}>
      <Header title={tr('comparing')} subtitle={tr('comparingSub', { n: lines.length, addr: household.address })} onBack={onBack} />
      <View style={{ paddingHorizontal: 20 }}><Skeleton lines={4} /><Skeleton /><Skeleton /></View>
      <Text style={[s.small, { textAlign: 'center' }]}>{slow ? tr('stillComparing') : tr('about20s')}</Text>
    </View>
  );

  const best = q.options[0];
  const nameOf = (id: string) => q.lines.find((l) => l.id === id)?.query ?? id;
  const oneDelivery = q.options.filter((o) => o.legs.length === 1 && o.kind !== 'pickup' && o.kind !== 'drive');
  // "Fast" is measured, not assumed: Wolt venues carry a live estimate in minutes;
  // the chains deliver in windows, counted as a day until the phone reads real slots.
  const etaOf = (sid: string) => q.etas?.[sid];
  // A shut store ranks after every open one: "הכי מהר" may never name a shop the family cannot order
  // from today (lib/compare.ts#etaRank).
  const etaMinutes = (o: PurchaseOption) => Math.max(...o.legs.map((l) => etaRank(etaOf(l.storefrontId))));
  const fastest = [...oneDelivery].sort((a, b) => etaMinutes(a) - etaMinutes(b) || a.cashCost - b.cashCost)[0];
  const balanced = fastest && best && fastest.cashCost - best.cashCost <= best.cashCost * 0.05 ? fastest : best;
  const pick = { cheap: best, balanced, fast: fastest ?? best }[strategy];

  // --- The design (docs/design/compare-screen.md): one answer, then every store as the same sentence. ---
  const brandsOf = (o: PurchaseOption) => o.legs.map((l) => l.brand).join(' + ');
  /**
   * When this store delivers. A venue that is **shut** says so in its own words when Wolt gave them and
   * the app is in Hebrew, else from the hour it reopens — it used to fall through to "משלוח בחלון",
   * which told a family a shop closed until 07:00 tomorrow would bring the list today (promises 2, 9).
   */
  const etaText = (sid: string): string | null => {
    const e = etaOf(sid);
    if (!e) return null;
    if (e.kind === 'live') return e.range ? tr('etaLiveRange', { r: e.range }) : tr('etaLive', { m: e.minutes ?? 0 });
    if (e.kind === 'closed') {
      const at = opensAt(e);
      if (e.text && isRTL()) return e.text;
      return at ? tr('etaClosedAt', { x: at }) : tr('etaClosed');
    }
    return tr('etaSlots');
  };
  const whenOf = (o: PurchaseOption) => [o.legs.length > 1 ? tr('twoDeliveries') : null, ...o.legs.map((l) => { const w = etaText(l.storefrontId); return w ? (o.legs.length > 1 ? `${l.brand}: ${w}` : w) : null; })].filter(Boolean).join(' · ');
  /**
   * The exceptions of `lib/compare.ts`, in the family's words. The facts — which lines an option
   * cannot supply, which swap belongs to which leg — are settled there, where a lab can check them;
   * here they only get named. "Not in stock at your branch" is not "this store does not carry it":
   * say which, here, not at the till.
   */
  const wordsFor = (ex: { missingLineIds: readonly string[]; swaps: readonly { productName: string; reason?: string }[] }, sids: readonly string[]) => {
    const outOfStock = new Set(sids.flatMap((sid) => q.branchStock?.[sid]?.lineIds ?? []));
    return {
      missing: ex.missingLineIds.map((id) => (outOfStock.has(id) ? tr('outOfStockAt', { x: short(nameOf(id)) }) : short(nameOf(id)))),
      swaps: ex.swaps.map((x) => (x.reason && x.reason.includes('→') ? x.reason : x.productName)),
    };
  };
  // "Out of stock at your branch" is a decision the family makes here, in Kaniti, not at the store's
  // till: the line, what we put in its place (the compare already priced it), and a way to change it.
  const outOfStockRows = (o: PurchaseOption | undefined) => {
    if (!o) return [];
    const rows: { lineId: string; asked: string; instead: string | null; sid: string }[] = [];
    for (const leg of o.legs) {
      for (const lineId of q.branchStock?.[leg.storefrontId]?.lineIds ?? []) {
        if (!leg.lineIds.includes(lineId) && !o.unpricedLineIds.includes(lineId)) continue;
        const sl = q.storefrontLines?.[leg.storefrontId]?.[lineId];
        rows.push({ lineId, asked: nameOf(lineId), instead: sl?.substituted ? sl.productName : null, sid: leg.storefrontId });
      }
    }
    return rows;
  };
  const noneAnywhere = q.lines.filter((l) => !Object.values(q.storefrontLines ?? {}).some((m) => m[l.id]));
  // A coupon is already inside a one-store option's cash (its delivered total is net of it); the price says so
  // in small print rather than a chip. A split's legs are summed from lines, so no coupon is folded there.
  const couponOf = (o: PurchaseOption) => (o.legs.length === 1 ? q.couponSavings?.[o.legs[0]!.storefrontId] ?? 0 : 0);
  const couponNote = (o: PurchaseOption) => (couponOf(o) > 0 ? tr('inclCoupon', { x: money(couponOf(o)) }) : undefined);
  // Every store this list cannot be bought from as-is, as a row: what it prices, what it lacks, how short.
  const answer = pick;
  /**
   * Every other way to buy this list, as one sentence each. The facts come from `rowsFor`; this turns
   * them into the row's words — and the words obey the design: an incomplete basket carries its
   * completed total, the difference from the answer is computed on that completed total, and a number
   * that is items only says so instead of sitting in the delivered column as if it were one.
   */
  const rows: RowView[] = rowsFor(q as unknown as CompareLike, answer as never).map((view) => {
    const o = view.option as PurchaseOption | undefined;
    const words = wordsFor(view, view.brands.map((b) => b.storefrontId));
    const priceNote = [
      view.completed !== undefined ? tr('completedTotal', { x: money(view.completed) }) : undefined,
      view.moreThanAnswer !== undefined ? `+${money(view.moreThanAnswer)}` : undefined,
      view.deliveredTotal ? undefined : tr('itemsOnlyN', { n: view.pricedLines ?? 0 }),
      o ? couponNote(o) : undefined,
    ].filter(Boolean).join(' · ') || undefined;
    const second = [
      view.shortOfMinimum !== undefined ? tr('tblShort', { x: money(view.shortOfMinimum) }) : null,
      words.missing.length ? tr('tblMissing', { x: words.missing.slice(0, 3).join(', ') + (words.missing.length > 3 ? '…' : '') }) : null,
      words.swaps.length ? tr('swapsLine', { x: words.swaps.slice(0, 2).join(' · ') + (words.swaps.length > 2 ? '…' : '') }) : null,
    ].filter(Boolean).join(' · ');
    const when = o ? whenOf(o) : etaText(view.storefrontId);
    return { view, title: view.brands.map((b) => b.brand).join(' + '), when: when || null, whenTone: etaTone(q.etas?.[view.storefrontId]), ...(priceNote ? { priceNote } : {}), second };
  });
  const buyRow = (view: CompareRow) => {
    if (view.option) { void orderBest(view.option as unknown as PurchaseOption, q, { pinnable: false }); return; }
    // A store the compare rejected is still a store the family may buy from: order what it has.
    const sid = view.storefrontId;
    const title = view.brands[0]!.brand;
    const sl = q.storefrontLines?.[sid] ?? {};
    const ids = Object.keys(sl);
    const pseudo = { kind: 'single_delivered', label: title, legs: [{ storefrontId: sid, brand: title, itemsSubtotal: view.price, deliveryFee: 0, lineIds: ids }], itemsSubtotal: view.price, fees: 0, cashCost: view.price, timeCost: 0, coverageRatio: q.lines.length ? ids.length / q.lines.length : 0, unpricedLineIds: q.lines.filter((l) => !sl[l.id]).map((l) => l.id), substitutedLineCount: Object.values(sl).filter((l) => l.substituted).length, explanation: { reason: '', savingVsBaseline: 0, baselineLabel: '', extraStores: 0, notes: [] } } as unknown as PurchaseOption;
    void orderBest(pseudo, q, { pinnable: false });
  };

  return (
    <View style={s.screen}>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 32 }}>
      <Header title={tr('howToBuy')} subtitle={tr('optionsSub', { n: q.lines.length, m: q.fromMemory.length })} onBack={onBack} />
      <View style={{ paddingHorizontal: 20 }}>
        {/* An item no store has today: named at the top, with the two things one can do about it. */}
        {noneAnywhere.map((l) => (
          <View key={l.id} style={[s.card, { backgroundColor: t.amberSoft }]} testID="none-anywhere">
            <Text style={[s.body, { color: t.amber, fontWeight: '700' }]}>{tr('noneAnywhere', { x: l.query })}</Text>
            <View style={[s.rowStart, { marginTop: 8, gap: 8 }]}>
              <Pressable onPress={() => removeLine(l.id)} style={{ borderWidth: 1, borderColor: t.amber, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14 }}><Text style={{ color: t.amber, fontWeight: '700', fontSize: 13 }}>{tr('removeIt')}</Text></Pressable>
              <Pressable onPress={onBack} style={{ backgroundColor: t.amber, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 }}><Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{tr('replaceIt')}</Text></Pressable>
            </View>
          </View>
        ))}

        {/* The one control: cheap ↔ fast. It re-orders; it never hides. */}
        <View style={{ backgroundColor: t.inkSoft, borderRadius: 999, padding: 4, flexDirection: s.row.flexDirection, marginBottom: 12 }}>
          {(['cheap', 'balanced', 'fast'] as const).map((k) => (
            <Pressable key={k} onPress={() => setStrategy(k)} style={[{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 999 }, strategy === k && { backgroundColor: t.card, shadowColor: '#0E1512', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } }]}>
              <Text style={{ color: strategy === k ? t.ink : t.muted, fontWeight: strategy === k ? '800' : '600', fontSize: 14 }}>{tr(`mode_${k}`)}</Text>
            </Pressable>
          ))}
        </View>

        {/* The answer: one number, one line of when, one line of why, the legs fold open. */}
        {answer ? (() => {
          const ex = wordsFor(exceptionsOf(q as unknown as CompareLike, answer as never), answer.legs.map((l) => l.storefrontId));
          /**
           * Why this one, in money. Promise 2: "the difference is stated in money and minutes".
           * The optimizer's own `savingVsBaseline` is silent in the ordinary case — it picks the winner
           * as its own baseline, so the card used to show a reason with no figure in it at all, and a
           * family was never told what Kaniti had just saved them. The figure that answers the question
           * they asked is the one against the next way they could buy this list, exact when that
           * alternative is complete and marked ≈ when its total rests on an estimate.
           */
          const vs = savingOf(q as unknown as CompareLike, answer as never);
          const why = answer !== best && best ? tr('costsVs', { x: money(answer.cashCost - best.cashCost) })
            : vs && vs.minor > 0 ? tr(vs.approx ? 'savesVsApprox' : 'savesVs', { x: money(vs.minor), b: vs.brand })
            : reasonT(answer.explanation.reason);
          const [legsOpen, tag] = [open === 'answer', strategy === 'cheap' ? tr('mode_cheap') : strategy === 'fast' ? tr('mode_fast') : tr('mode_balanced')];
          return (
            <Pressable onPress={() => setOpen(legsOpen ? null : 'answer')} style={[s.card, { borderWidth: 2, borderColor: t.accent }]} testID="answer-card">
              <View style={s.row}>
                <View style={[s.rowStart, { flex: 1, gap: 8, flexWrap: 'wrap' }]}>
                  <Chip text={tag} tone="good" />
                  <Text style={[s.title, { fontSize: 18, flexShrink: 1 }]} numberOfLines={2}>{brandsOf(answer)}</Text>
                </View>
                <View style={{ alignItems: isRTL() ? 'flex-start' : 'flex-end' }}>
                  <Text style={s.priceBig}>{money(answer.cashCost)}</Text>
                  {couponNote(answer) ? <Text style={[s.faint, { fontSize: 11 }]} testID="answer-coupon">{couponNote(answer)}</Text> : null}
                </View>
              </View>
              {whenOf(answer) ? <Text style={[s.small, { marginTop: 6 }]}>{whenOf(answer)}</Text> : null}
              <Text style={[s.small, { color: t.accent, marginTop: 2 }]}>{why}</Text>
              {ex.missing.length ? <Text style={[s.small, { color: t.red, marginTop: 6 }]}>{tr('unavailable', { x: ex.missing.join(', ') })}{answer.missingEstimate ? ` · ${tr('toComplete', { x: money(answer.missingEstimate) })}` : ''}</Text> : null}
              {ex.swaps.length ? <Text style={[s.small, { color: t.amber, marginTop: 4 }]}>{tr('swapsLine', { x: ex.swaps.join(' · ') })}</Text> : null}
              {/* Out of stock at the family's branch: said here, with the alternative, before anyone shops. */}
              {outOfStockRows(answer).map((r) => (
                <View key={`oos-${r.lineId}`} style={{ marginTop: 8, backgroundColor: t.amberSoft, borderRadius: 10, padding: 10 }} testID={`oos-${r.lineId}`}>
                  <Text style={[s.small, { color: t.amber }]}>{tr('oosTitle', { x: r.asked })}</Text>
                  <Text style={[s.body, { marginTop: 2 }]} numberOfLines={2}>{r.instead ? tr('oosInstead', { y: r.instead }) : tr('oosNone')}</Text>
                  <View style={[s.rowStart, { gap: 14, marginTop: 6 }]}>
                    <Pressable onPress={(e) => { e.stopPropagation?.(); setFixing(r.asked); }} hitSlop={8}><Text style={[s.small, { color: t.accent }]}>{tr('oosPickOther')}</Text></Pressable>
                    <Pressable onPress={(e) => { e.stopPropagation?.(); removeLine(r.lineId); setQ(null); api.quote(household.id, lines.filter((l) => l.id !== r.lineId).map(({ id: _i, imageUrl: _u, productName: _n, size: _s, ...l }) => l)).then(setQ).catch(() => null); }} hitSlop={8}><Text style={[s.small, { color: t.red }]}>{tr('oosDrop')}</Text></Pressable>
                  </View>
                </View>
              ))}
              <Text style={[s.small, { marginTop: 8 }]}>{legsOpen ? '▾' : '▸'} {answer.legs.map((l) => tr('legsLine', { n: l.lineIds.length, b: l.brand })).join(' · ')}</Text>
              {/* Unfolded, the winner explains itself like every other store: each leg's money, then the
                  products that leg priced. Without this a split is two brands and one number, and the
                  family cannot see that one store's "חלב 3%" is a 2 ℓ bottle and the other's a 1 ℓ bag. */}
              {legsOpen ? answer.legs.map((leg) => (
                <View key={leg.storefrontId} style={{ marginTop: 4 }}>
                  <View style={[s.row, { paddingVertical: 3 }]}>
                    <Text style={s.small}>{leg.brand}</Text>
                    <Text style={s.priceSmall}>{money(leg.itemsSubtotal)} + {money(leg.deliveryFee)} {tr('delivery')}</Text>
                  </View>
                  <View style={{ paddingHorizontal: 8 }} testID={`answer-lines-${leg.storefrontId}`}>
                    <StoreLineList lines={q.lines} storeLines={q.storefrontLines?.[leg.storefrontId] ?? {}} ids={leg.lineIds} />
                  </View>
                </View>
              )) : null}
              {legsOpen && answer.timeCost > 0 ? <View style={[s.row, { paddingVertical: 3 }]}><Text style={s.small}>{tr('timeSeparate')}</Text><Text style={s.priceSmall}>{money(answer.timeCost)}</Text></View> : null}
            </Pressable>
          );
        })() : <View style={s.card}><Text style={s.body}>{tr('noneCover')}</Text></View>}

        {/* Every other store, the same sentence: price · when · what it lacks. Tap for its lines and "buy here". */}
        {rows.length ? (
          <View style={[s.card, { paddingVertical: 6 }]}>
            <Text style={[s.title, { fontSize: 16, paddingVertical: 8 }]}>{tr('altTitle')}</Text>
            {/* Already ordered by what the family would really pay (lib/compare.ts#rowsFor): options
                first, by their completed totals, so a partial basket never jumps a full one. */}
            {rows.map((row) => (
              <StoreRow key={row.view.key} row={row} open={open === row.view.key} onToggle={() => setOpen(open === row.view.key ? null : row.view.key)} quote={q} onBuy={() => buyRow(row.view)} />
            ))}
          </View>
        ) : null}

        {/* Driving there: the branches near home, same shape, compared like with like. */}
        {q.drive ? (
          <View style={[s.card, { paddingVertical: 6 }]} testID="drive-card">
            <Text style={[s.title, { fontSize: 16, paddingTop: 8 }]}>{tr('driveTitle')}</Text>
            <Text style={[s.faint, { fontSize: 11, paddingBottom: 6 }]}>{tr('driveSub')}</Text>
            {q.drive.status === 'pending' || q.drive.branches.length === 0
              ? <Text style={[s.small, { paddingVertical: 8 }]}>{q.drive.status === 'pending' ? tr('drivePending') : q.drive.status === 'none' ? tr('driveNoAddress') : tr('driveNone')}</Text>
              : q.drive.branches.map((b) => {
                // The price files name a branch with its code, "(4420)"; the code is theirs, not the family's.
                // The brand is dropped when the branch name already carries it ("קרפור מרקט …").
                const branch = b.branchName.replace(/\s*\(\d+\)/g, '').trim();
                const title = branch.includes(b.brand) ? branch : `${b.brand} · ${branch}`;
                const full = b.coveredLines === b.totalLines;
                const ref = b.sameLines ? (full ? b.sameLines.delivered : b.sameLines.items) : 0;
                const diff = ref > 0 ? ref - (b.itemsSubtotal + (full ? b.driveCost : 0)) : 0;
                // A full basket is compared delivered-vs-driven and may claim a saving (or a cost). A partial one is only
                // set beside the same lines at the winning store — like for like, no saving claimed, so no colour either.
                // The sentence is the row's last line, not a note under the price: the winner's name can be long
                // ("מחסני השוק | רמת גן (וולט)") and the price column is too narrow to keep it on one line.
                const note = ref <= 0 ? undefined : full ? (diff > 0 ? tr('driveSaves', { x: money(diff) }) : tr('driveCosts', { x: money(-diff) })) : tr(b.coveredLines === 1 ? 'driveSameLine1' : 'driveSameLines', { n: b.coveredLines, s: b.sameLines!.brand, x: money(ref) });
                const noteColor = ref <= 0 || !full ? t.muted : diff > 0 ? t.accent : t.amber;
                return (
                  <View key={b.storefrontId} style={[s.row, { gap: 10, paddingVertical: 9, borderTopWidth: 1, borderColor: t.line }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.body, { fontSize: 15, fontWeight: '600' }]} numberOfLines={1}>{title}</Text>
                      <Text style={[s.faint, { fontSize: 11 }]} numberOfLines={1}>{tr('driveRow', { d: b.distanceKm, m: b.minutes, x: money(b.driveCost) })}</Text>
                      <Text style={[s.faint, { fontSize: 11 }]} numberOfLines={1}>{full ? tr('driveAll', { n: b.totalLines }) : tr('driveCovers', { n: b.coveredLines, t: b.totalLines })}{b.missingLineIds.length > 0 && b.missingLineIds.length <= 3 ? ` · ${tr('tblMissing', { x: b.missingLineIds.map((id) => short(nameOf(id))).join(', ') })}` : ''}</Text>
                      {note ? <Text style={[s.faint, { fontSize: 11, color: noteColor }]} numberOfLines={1} testID={`drive-note-${b.storefrontId}`}>{note}</Text> : null}
                    </View>
                    <PriceCol price={money(b.itemsSubtotal)} color={full && diff > 0 ? t.accent : t.ink} />
                  </View>
                );
              })}
            {q.drive.status === 'ready' && q.drive.branches.length > 0 ? <Text style={[s.faint, { fontSize: 11, paddingVertical: 6 }]}>{tr('driveNote')}</Text> : null}
          </View>
        ) : null}

        {q.warnings.length > 0 && (
          <View style={[s.card, { backgroundColor: t.amberSoft }]}>
            <Text style={[s.title, { color: t.amber, fontSize: 17 }]}>{tr('confirmOnce')}</Text>
            <Text style={[s.small, { color: t.amber, marginBottom: 6 }]}>{tr('confirmOnceSub')} {tr('tapToFix')}</Text>
            {q.warnings.map((w, i) => {
              const phrase = /"([^"]+)"/.exec(w)?.[1] ?? w;
              return (
                <Pressable key={i} onPress={() => setFixing(phrase)} style={[s.row, { paddingVertical: 8, borderTopWidth: 1, borderColor: '#EFDDB6' }]}>
                  <Text style={[s.body, { color: t.amber }]}>{phrase}</Text>
                  <Text style={[s.link, { color: t.amber }]}>›</Text>
                </Pressable>
              );
            })}
          </View>
        )}
        {fixing ? <ConfirmSheet api={api} household={household} phrase={fixing} onClose={() => setFixing(null)} onConfirmed={() => { setFixing(null); setQ(null); api.quote(household.id, lines.map(({ id: _i, imageUrl: _u, productName: _n, size: _s, ...l }) => l)).then(setQ).catch(() => null); }} /> : null}
      </View>
    </ScrollView>
    {answer ? (
      <View style={{ padding: 16, paddingBottom: 20, backgroundColor: t.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 16, shadowOffset: { width: 0, height: -4 } }}>
        <Button testID="order-now" title={tr('orderNow', { x: money(answer.cashCost) })} onPress={() => orderBest(answer, q)} disabled={ordering} />
        <Pressable onPress={() => onChoose(answer, q)} style={{ paddingTop: 10, alignItems: 'center' }}><Text style={s.link}>{tr('linksInstead')}</Text></Pressable>
      </View>
    ) : null}
    {onDevice ? <OrderOnDevice storeId={onDevice.storeId} lines={onDevice.lines} api={api} householdId={household.id} onClose={() => setOnDevice(null)} onDone={(a) => void onDeviceDone(a)} /> : null}
      {needLink ? (
      <StoreLink storeId={needLink.retailer} api={api} householdId={household.id} onClose={() => setNeedLink(null)}
        onLinked={(id) => { markLinked(id); const { best: b, q: qq } = needLink; setNeedLink(null); void orderBest(b, qq); }} />
    ) : null}
    </View>
  );
}

/** After choosing: deep links per item, and a "done" that teaches memory. */
export function CheckoutScreen({ api, household, option, quote, onDone, onBack, onOrder }: {
  api: Api; household: Household; option: PurchaseOption; quote: QuoteResult; onDone: () => void; onBack: () => void; onOrder: (orderId: string) => void;
}) {
  const s = S();
  const [busy, setBusy] = useState(false);
  const lineOf = (id: string) => quote.lines.find((l) => l.id === id);
  const done = async () => {
    setBusy(true);
    // What the memory learns is what this store sold them — the product the screen named and the
    // cart added, not the winner's resolution. A memory of a product they never bought is worse
    // than no memory: it comes back as "the usual" next week.
    const bought = option.legs.flatMap((leg) => leg.lineIds.map((id) => ({ id, sid: leg.storefrontId }))).flatMap(({ id, sid }) => {
      const l = lineOf(id); const { gtin, productName } = productAt(quote, sid, id);
      if (!l || !gtin || !productName) return [];
      return [{ phrase: l.query, gtin, productName, ...(l.brand ? { brand: l.brand } : {}), ...(l.amount !== undefined && l.unit ? { amount: l.amount, unit: l.unit } : {}), ...(l.packQty !== undefined ? { packQty: l.packQty } : {}) }];
    });
    try { await api.recordShop(household.id, bought); onDone(); } finally { setBusy(false); }
  };
  const orderable = legsFor(option, quote);
  const [ordering, setOrdering] = useState(false);
  const orderViaKaniti = async () => {
    if (orderable.length === 0) return;
    setOrdering(true);
    try { const o = await api.createOrder(household.id, orderable); onOrder(o.id); } finally { setOrdering(false); }
  };
  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingBottom: 32 }}>
      <Header title={option.label} subtitle={tr('payAtStore')} onBack={onBack} />
      {orderable.length > 0 ? (
        <View style={{ paddingHorizontal: 20, marginBottom: 6 }}>
          <Button title={tr('orderViaKaniti')} onPress={orderViaKaniti} disabled={ordering} />
          <Text style={[s.faint, { marginTop: 6, textAlign: 'center' }]}>{tr('noWorker')}</Text>
        </View>
      ) : null}
      <View style={{ paddingHorizontal: 20 }}>
        <View style={[s.row, { marginBottom: 12 }]}><Text style={s.small}>{tr('estTotal')}</Text><Text style={s.priceBig}>{money(option.cashCost)}</Text></View>
        {option.legs.map((leg) => (
          <View key={leg.storefrontId} style={s.card}>
            <View style={s.row}><Text style={s.title}>{leg.brand}</Text><Text style={s.price}>{money(leg.itemsSubtotal)}</Text></View>
            {leg.lineIds.map((id, i) => {
              const l = lineOf(id); const ql = quote.quotedLines[id];
              // This store's own product, exactly as `cartLinesFor` will add it; the winner's
              // resolution only as a fallback. Naming the other store's product here is a promise
              // broken twice over: the basket fills with something else, and a split reads as one.
              const p = productAt(quote, leg.storefrontId, id);
              const name = p.productName ?? '';
              const link = p.link;
              return (
                <Pressable key={id} onPress={() => link && Linking.openURL(link)} style={[s.row, { paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderColor: t.line, marginTop: i === 0 ? 8 : 0 }]}>
                  <View style={[s.rowStart, { flex: 1, gap: 10 }]}>
                    {/* The shared resolution's photo only when it is the same barcode; otherwise the
                        barcode's own picture, and the aisle glyph when there is none. Never another
                        product's photo next to this product's name. */}
                    <ProductImage url={p.gtin && p.gtin === ql?.gtin ? ql?.imageUrl : null} gtin={p.gtin} name={name || l?.query || ''} size={44} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.body}>{l?.query}</Text>
                      <Text style={s.small} numberOfLines={2} testID={`checkout-name-${id}`}>{name}</Text>
                    </View>
                  </View>
                  {link ? <Text style={s.link}>{tr('open')}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        ))}
        <Button title={tr('done')} onPress={done} disabled={busy} />
        <Text style={[s.small, { marginTop: 10, textAlign: 'center' }]}>{tr('learnsOnly')}</Text>
      </View>
    </ScrollView>
  );
}


/** Pick the exact product for a phrase, once. Photo cards; a tap writes memory. */
function ConfirmSheet({ api, household, phrase, onClose, onConfirmed }: { api: Api; household: Household; phrase: string; onClose: () => void; onConfirmed: () => void }) {
  const s = S();
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.search(household.id, phrase).then((r) => setHits(r.products)).catch(() => setHits([])); }, [api, household.id, phrase]);
  const pick = async (h: SearchHit) => {
    if (!h.gtin) return;
    setBusy(true);
    try { await api.confirm(household.id, { phrase, gtin: h.gtin, productName: h.name, ...(h.brand ? { brand: h.brand } : {}) }); onConfirmed(); } finally { setBusy(false); }
  };
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[s.screen, { paddingTop: 12 }]}>
        <Header title={phrase} subtitle={tr('tapToFix')} onBack={onClose} />
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 30 }}>
          {!hits ? <Loading label={tr('searching')} /> : hits.map((h) => (
            <Pressable key={h.productId} onPress={() => pick(h)} disabled={busy || !h.gtin} style={({ pressed }) => [s.card, s.row, pressed && { opacity: 0.6 }]}>
              <View style={[s.rowStart, { flex: 1, gap: 12 }]}>
                <ProductImage url={h.imageUrl} gtin={h.gtin} name={h.name} size={56} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.body, { fontSize: 15 }]} numberOfLines={2}>{h.name}</Text>
                  {h.brand ? <Chip text={h.brand} tone="good" /> : null}
                </View>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                {h.fromPrice !== undefined ? <Text style={s.price}>{money(h.fromPrice)}</Text> : null}
                <Text style={s.link}>{tr('pickThis')}</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}
