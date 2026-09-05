import React, { useEffect, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import type { PurchaseOption } from '@fca/domain';
import type { Api, Household, QuoteResult } from '../lib/api';
import type { Line } from '../lib/store';
import { Button, Chip, Header, Loading, Rank, S, t } from '../ui';
import { ProductImage } from '../ProductImage';
import type { SearchHit } from '../lib/api';
import { money, reasonT, rejectionT, t as tr } from '../lib/i18n';

const LETTERS = 'אבגדה';

/**
 * The costed ways to buy the list. Cash is the headline; time cost is shown
 * separately and never merged. Anything a storefront cannot supply is named.
 */
export function OptionsScreen({ api, household, lines, onBack, onChoose }: {
  api: Api; household: Household; lines: Line[]; onBack: () => void; onChoose: (opt: PurchaseOption, q: QuoteResult) => void;
}) {
  const s = S();
  const [q, setQ] = useState<QuoteResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fixing, setFixing] = useState<string | null>(null);
  useEffect(() => {
    api.quote(household.id, lines.map(({ id: _i, imageUrl: _u, productName: _n, ...l }) => l)).then(setQ).catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, [api, household.id, lines]);

  if (err) return <View style={s.screen}><Header title={tr('wentWrong')} onBack={onBack} /><Text style={[s.body, s.pad, { color: t.red }]}>{err}</Text></View>;
  if (!q) return <View style={s.screen}><Header title={tr('comparing')} subtitle={tr('comparingSub', { n: lines.length, addr: household.address })} onBack={onBack} /><Loading label={tr('about20s')} /></View>;

  const best = q.options[0];
  const nameOf = (id: string) => q.lines.find((l) => l.id === id)?.query ?? id;
  const spread = q.options.length > 1 ? q.options[q.options.length - 1]!.cashCost - best!.cashCost : 0;

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingBottom: 32 }}>
      <Header title={tr('howToBuy')} subtitle={tr('optionsSub', { n: q.lines.length, m: q.fromMemory.length }) + (spread > 0 ? tr('spread', { x: money(spread) }) : '')} onBack={onBack} />
      <View style={{ paddingHorizontal: 20 }}>
        {q.options.length === 0 && <View style={s.card}><Text style={s.body}>{tr('noneCover')}</Text></View>}

        {q.options.map((o, i) => {
          const isBest = i === 0;
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
                {o.substitutedLineCount > 0 && <Chip text={tr('subs', { n: o.substitutedLineCount })} tone="warn" />}
              </View>
            </Pressable>
          );
        })}

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

        {q.rejected.length > 0 && (
          <View style={{ marginTop: 4 }}>
            <Text style={[s.small, { marginBottom: 4 }]}>{tr('notOffered')}</Text>
            {q.rejected.map((r, i) => <Text key={i} style={s.faint}>{r.brand} · {rejectionT(r.reason)}</Text>)}
          </View>
        )}
      </View>
    </ScrollView>
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
  const orderable = option.legs.filter((leg) => /shufersal/i.test(leg.storefrontId));
  const [ordering, setOrdering] = useState(false);
  const orderViaKanili = async () => {
    const leg = orderable[0];
    if (!leg) return;
    setOrdering(true);
    try {
      const lines = leg.lineIds.flatMap((id) => { const l = lineOf(id); const ql = quote.quotedLines[id]; return l ? [{ query: l.query, ...(ql?.gtin ? { gtin: ql.gtin } : l.gtin ? { gtin: l.gtin } : {}), ...(l.brand ? { brand: l.brand } : {}), ...(l.amount !== undefined ? { amount: l.amount } : {}), ...(l.unit ? { unit: l.unit } : {}), ...(l.packQty !== undefined ? { packQty: l.packQty } : {}) }] : []; });
      const o = await api.createOrder(household.id, 'shufersal', lines);
      onOrder(o.id);
    } finally { setOrdering(false); }
  };
  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingBottom: 32 }}>
      <Header title={option.label} subtitle={tr('payAtStore')} onBack={onBack} />
      {orderable.length > 0 ? (
        <View style={{ paddingHorizontal: 20, marginBottom: 6 }}>
          <Button title={tr('orderViaKanili')} onPress={orderViaKanili} disabled={ordering} />
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
