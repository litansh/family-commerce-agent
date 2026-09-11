import React, { useEffect, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import type { PurchaseOption } from '@fca/domain';
import type { Api, Household, QuoteResult } from '../lib/api';
import type { Line } from '../lib/store';
import { Button, Chip, Header, Loading, Rank, S, Skeleton, t } from '../ui';
import { ProductImage } from '../ProductImage';
import type { SearchHit } from '../lib/api';
import { money, reasonT, t as tr } from '../lib/i18n';
import { markLinked, useLinked } from '../lib/linked';
import { getMode, setMode } from '../lib/prefs';
import { StoreLink } from './StoreLink';
import { storeForStorefront, type CartLine } from '../lib/stores';
import { OrderOnDevice } from './OrderOnDevice';
import { Platform } from 'react-native';

const LETTERS = 'אבגדה';

/**
 * The costed ways to buy the list. Cash is the headline; time cost is shown
 * separately and never merged. Anything a storefront cannot supply is named.
 */
const retailerOf = (storefrontId: string) => storeForStorefront(storefrontId)?.id;
/** What goes into the store's cart for one leg: barcode, name, quantity, and the deep link as the fallback. */
function cartLinesFor(leg: PurchaseOption['legs'][number], quote: QuoteResult): CartLine[] {
  return leg.lineIds.flatMap((id) => {
    const l = quote.lines.find((x) => x.id === id); const ql = quote.quotedLines[id];
    if (!l) return [];
    return [{ ...(ql?.gtin ? { gtin: ql.gtin } : l.gtin ? { gtin: l.gtin } : {}), name: ql?.productName ?? l.query, qty: Math.max(1, Math.round(l.packQty ?? 1)), ...(ql?.link ? { link: ql.link } : {}) }];
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
    // Teach the memory what went into the cart, then the next store if the basket is split.
    const bought = added.filter((l) => l.gtin).map((l) => ({ phrase: l.name, gtin: l.gtin!, productName: l.name, packQty: l.qty }));
    if (bought.length) await api.recordShop(household.id, bought).catch(() => null);
    if (cur.rest.length) setOnDevice({ ...cur.rest[0]!, rest: cur.rest.slice(1), best: cur.best, q: cur.q });
    else { setOnDevice(null); onChoose(cur.best, cur.q); }
  };
  const orderBest = async (bestIn: PurchaseOption, q: QuoteResult) => {
    let best = bestIn;
    // Driven simulator runs may pin the store to order from (EXPO_PUBLIC_E2E_ORDER_STORE); inert otherwise.
    const pin = process.env['EXPO_PUBLIC_E2E_ORDER_STORE'];
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
  const [whyNot, setWhyNot] = useState(false);
  useEffect(() => {
    api.quote(household.id, lines.map(({ id: _i, imageUrl: _u, productName: _n, ...l }) => l)).then(setQ).catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, [api, household.id, lines]);

  if (err) return <View style={s.screen}><Header title={tr('wentWrong')} onBack={onBack} /><Text style={[s.body, s.pad, { color: t.red }]}>{err}</Text></View>;
  if (!q) return (
    <View style={s.screen}>
      <Header title={tr('comparing')} subtitle={tr('comparingSub', { n: lines.length, addr: household.address })} onBack={onBack} />
      <View style={{ paddingHorizontal: 20 }}><Skeleton lines={4} /><Skeleton /><Skeleton /></View>
      <Text style={[s.small, { textAlign: 'center' }]}>{tr('about20s')}</Text>
    </View>
  );

  const best = q.options[0];
  const nameOf = (id: string) => q.lines.find((l) => l.id === id)?.query ?? id;
  const spread = q.options.length > 1 ? q.options[q.options.length - 1]!.cashCost - best!.cashCost : 0;
  const oneDelivery = q.options.filter((o) => o.legs.length === 1 && o.kind !== 'pickup');
  const fastest = oneDelivery[0];
  const balanced = fastest && best && fastest.cashCost - best.cashCost <= best.cashCost * 0.05 ? fastest : best;
  const pick = { cheap: best, balanced, fast: fastest ?? best }[strategy];
  const shown = pick ? [pick, ...q.options.filter((o) => o !== pick).slice(0, 2)] : [];
  const chosen = shown[0] ?? best;
  const fastExtra = fastest && best ? fastest.cashCost - best.cashCost : 0;

  return (
    <View style={s.screen}>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 32 }}>
      <Header title={tr('howToBuy')} subtitle={tr('optionsSub', { n: q.lines.length, m: q.fromMemory.length }) + (spread > 0 ? tr('spread', { x: money(spread) }) : '')} onBack={onBack} />
      <View style={{ paddingHorizontal: 20 }}>
        {q.options.length === 0 && <View style={s.card}><Text style={s.body}>{tr('noneCover')}</Text></View>}

        {/* The one control on this screen: cheap ↔ fast. */}
        <View style={{ backgroundColor: t.inkSoft, borderRadius: 999, padding: 4, flexDirection: s.row.flexDirection, marginBottom: 8 }}>
          {(['cheap', 'balanced', 'fast'] as const).map((k) => (
            <Pressable key={k} onPress={() => setStrategy(k)} style={[{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 999 }, strategy === k && { backgroundColor: t.card, shadowColor: '#0E1512', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } }]}>
              <Text style={{ color: strategy === k ? t.ink : t.muted, fontWeight: strategy === k ? '800' : '600', fontSize: 14 }}>{tr(`mode_${k}`)}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[s.small, { marginBottom: 12 }]}>
          {strategy === 'fast'
            ? (fastest ? (fastExtra > 0 ? tr('modeFastCost', { x: money(fastExtra) }) : tr('modeFastFree')) : tr('modeFastNone'))
            : strategy === 'balanced' ? tr('modeBalancedSub') : (fastExtra > 0 && best && best.legs.length > 1 ? tr('modeCheapSub', { n: best.legs.length, x: money(fastExtra) }) : tr('modeCheapOne'))}
        </Text>
        {shown.length === 0 ? <View style={s.card}><Text style={s.body}>{tr('strat_none')}</Text></View> : null}
        {shown.map((o, i) => {
          const isBest = o === best;
          const extra = best && !isBest ? o.cashCost - best.cashCost : 0;
          return (
            <Pressable key={i} onPress={() => onChoose(o, q)} style={({ pressed }) => [s.card, isBest && { borderWidth: 2, borderColor: t.accent }, pressed && { opacity: 0.85 }]}>
              <View style={s.row}>
                <View style={[s.rowStart, { flex: 1 }]}>
                  <Rank letter={LETTERS[i] ?? '?'} best={isBest} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.title, { fontSize: 18 }]} numberOfLines={1}>{o.label}</Text>
                    <Text style={s.small}>{reasonT(o.explanation.reason)}</Text>
                  </View>
                </View>
              </View>
              <View style={[s.row, { marginTop: 12, alignItems: 'flex-end' }]}>
                <Text style={s.priceBig}>{money(o.cashCost)}</Text>
                {isBest ? <Chip text={tr('best')} tone="good" /> : extra > 0 ? <Text style={[s.small, { color: t.amber }]}>+{money(extra)}</Text> : null}
              </View>
              <View style={s.hair} />
              {o.legs.map((leg) => (
                <View key={leg.storefrontId} style={[s.row, { paddingVertical: 3 }]}>
                  <Text style={s.small}>{leg.brand} · {leg.lineIds.length} {tr('items')}</Text>
                  <Text style={s.priceSmall}>{money(leg.itemsSubtotal)} + {money(leg.deliveryFee)} {tr('delivery')}</Text>
                </View>
              ))}
              {o.timeCost > 0 && <View style={[s.row, { paddingVertical: 3 }]}><Text style={s.small}>{tr('timeSeparate')}</Text><Text style={s.priceSmall}>{money(o.timeCost)}</Text></View>}
              {o.unpricedLineIds.length > 0 && <Text style={[s.small, { color: t.red, marginTop: 8 }]}>{tr('unavailable', { x: o.unpricedLineIds.map(nameOf).join(', ') })}</Text>}
              <View style={[s.rowStart, { marginTop: 10 }]}>
                <Chip text={tr('coverage', { p: Math.round(o.coverageRatio * 100) })} tone={o.coverageRatio >= 0.99 ? 'good' : 'neutral'} />
                {(() => { const cs = o.legs.reduce((sum, leg) => sum + (q.couponSavings?.[leg.storefrontId] ?? 0), 0); return cs > 0 ? <Chip text={tr('couponChip', { x: money(cs) })} tone="good" /> : null; })()}
                {o.substitutedLineCount > 0 && <Chip text={tr('subs', { n: o.substitutedLineCount })} tone="warn" />}
              </View>
            </Pressable>
          );
        })}

        {/* Every store, one line each: what this basket costs there, or why it cannot be bought there. */}
        {(() => {
          const singles = q.options.filter((o) => o.legs.length === 1 && o.kind !== 'pickup').map((o) => ({ brand: o.legs[0]!.brand, total: o.cashCost, coverage: o.coverageRatio, ok: true as const }));
          const rej = q.rejected.map((r) => ({ brand: r.brand, total: r.itemsSubtotal, coverage: r.requestedLines ? r.pricedLines / r.requestedLines : 0, ok: false as const, short: r.code === 'minimum' ? r.amountToMinimum : undefined }));
          const rows = [...singles, ...rej].sort((a, b) => Number(b.ok) - Number(a.ok) || a.total - b.total);
          if (rows.length === 0) return null;
          const cheapest = singles.length ? Math.min(...singles.map((x) => x.total)) : 0;
          return (
            <View style={[s.card, { paddingVertical: 6 }]}>
              <Text style={[s.title, { fontSize: 16, paddingVertical: 8 }]}>{tr('tblStores')}</Text>
              {rows.map((r, i) => (
                <View key={`${r.brand}-${i}`} style={[s.row, { paddingVertical: 9, borderTopWidth: 1, borderColor: t.line, opacity: r.ok ? 1 : 0.6 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.body, { fontSize: 15, fontWeight: '600' }]} numberOfLines={1}>{r.brand}</Text>
                    <Text style={[s.faint, { fontSize: 11 }]}>{r.ok ? tr('tblCovers', { p: Math.round(r.coverage * 100) }) : r.short !== undefined ? tr('tblShort', { x: money(r.short) }) : tr('tblCovers', { p: Math.round(r.coverage * 100) })}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[s.price, { fontSize: 18, color: r.ok && r.total === cheapest ? t.accent : t.ink }]}>{money(r.total)}</Text>
                    {r.ok && r.total > cheapest ? <Text style={[s.faint, { fontSize: 11 }]}>+{money(r.total - cheapest)}</Text> : null}
                  </View>
                </View>
              ))}
            </View>
          );
        })()}
        {q.rejected.length > 0 ? (
          <Pressable onPress={() => setWhyNot((v) => !v)} style={{ paddingVertical: 8, alignItems: 'center' }}><Text style={s.link}>{tr('whyNot')} ({q.rejected.length}) {whyNot ? '▴' : '▾'}</Text></Pressable>
        ) : null}
        {whyNot ? (
          <View style={[s.card, { paddingVertical: 8 }]}>
            {[...q.rejected].sort((a, b) => (a.amountToMinimum ?? 1e9) - (b.amountToMinimum ?? 1e9)).map((r) => (
              <Text key={r.storefrontId} style={[s.small, { paddingVertical: 6, borderTopWidth: 1, borderColor: t.line }]}>
                {r.code === 'minimum' && r.minimumOrder !== undefined
                  ? tr('minShort', { b: r.brand, p: money(r.itemsSubtotal), x: money(r.amountToMinimum ?? 0), m: money(r.minimumOrder) })
                  : tr('covShort', { b: r.brand, a: r.pricedLines, c: r.requestedLines })}
              </Text>
            ))}
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
        {fixing ? <ConfirmSheet api={api} household={household} phrase={fixing} onClose={() => setFixing(null)} onConfirmed={() => { setFixing(null); setQ(null); api.quote(household.id, lines.map(({ id: _i, imageUrl: _u, productName: _n, ...l }) => l)).then(setQ).catch(() => null); }} /> : null}


      </View>
    </ScrollView>
    {chosen ? (
      <View style={{ padding: 16, paddingBottom: 20, backgroundColor: t.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 16, shadowOffset: { width: 0, height: -4 } }}>
        <Button testID="order-now" title={tr('orderNow', { x: money(chosen.cashCost) })} onPress={() => orderBest(chosen, q)} disabled={ordering} />
        <Pressable onPress={() => onChoose(chosen, q)} style={{ paddingTop: 10, alignItems: 'center' }}><Text style={s.link}>{tr('linksInstead')}</Text></Pressable>
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
    const bought = option.legs.flatMap((leg) => leg.lineIds).flatMap((id) => {
      const l = lineOf(id); const ql = quote.quotedLines[id];
      if (!l || !ql?.gtin) return [];
      return [{ phrase: l.query, gtin: ql.gtin, productName: ql.productName, ...(l.brand ? { brand: l.brand } : {}), ...(l.amount !== undefined && l.unit ? { amount: l.amount, unit: l.unit } : {}), ...(l.packQty !== undefined ? { packQty: l.packQty } : {}) }];
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
              return (
                <Pressable key={id} onPress={() => ql?.link && Linking.openURL(ql.link)} style={[s.row, { paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderColor: t.line, marginTop: i === 0 ? 8 : 0 }]}>
                  <View style={[s.rowStart, { flex: 1, gap: 10 }]}>
                    <ProductImage url={ql?.imageUrl} gtin={ql?.gtin} name={ql?.productName ?? l?.query ?? ''} size={44} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.body}>{l?.query}</Text>
                      <Text style={s.small} numberOfLines={1}>{ql?.productName ?? ''}</Text>
                    </View>
                  </View>
                  {ql?.link ? <Text style={s.link}>{tr('open')}</Text> : null}
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
