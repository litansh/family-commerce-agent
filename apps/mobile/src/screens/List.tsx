import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { HouseholdMemory, ProductPreference, Suggestion } from '@fca/domain';
import type { Api, Deal, Household, SearchHit } from '../lib/api';
import { AISLES, aisleOf } from '../lib/categories';
import { currentRegion, isRTL, money, t as tr } from '../lib/i18n';
import { newId, setLines, useList, type Line } from '../lib/store';
import { carouselProps } from '../lib/gesture';
import { MODES, setMode, useMode } from '../lib/prefs';
import { ProductImage } from '../ProductImage';
import { Scanner } from '../Scanner';
import { Button, Chip, Empty, Header, Icon, Input, S, t, Toast } from '../ui';

const tap = () => { if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

/**
 * The shared list.
 *
 *  - your usuals as one-tap tiles, from the household's own memory
 *  - search-as-you-type with product photos; picking a card pins the exact
 *    product (barcode, brand), which is what makes memory precise
 *  - grouped by aisle, quantity inline
 */
export function ListScreen({ api, household, onQuote, onInvite }: {
  api: Api; household: Household; onQuote: (lines: Line[]) => void; onInvite: () => void;
}) {
  const s = S();
  const rtl = isRTL();
  const lines = useList();
  const mode = useMode();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [memory, setMemory] = useState<HouseholdMemory | null>(null);
  const pricing = currentRegion().pricingAvailable;
  const seq = useRef(0);
  const [scanning, setScanning] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [imp, setImp] = useState<{ status: string; orders?: number; products?: number; error?: string } | null>(null);
  const firstRetailer = household.retailers?.[0];
  useEffect(() => {
    if (!firstRetailer) return;
    let alive = true;
    const poll = async () => {
      const st = await api.importStatus(household.id, firstRetailer).catch(() => null);
      if (!alive) return;
      setImp(st);
      if (st && ['queued', 'connecting', 'reading', 'resolving'].includes(st.status)) setTimeout(poll, 4000);
      if (st?.status === 'done') api.memory(household.id).then(setMemory).catch(() => null);
    };
    void poll();
    return () => { alive = false; };
  }, [api, household.id, firstRetailer]);
  const startImport = async () => { if (!firstRetailer) return; tap(); setImp({ status: 'queued' }); await api.requestImport(household.id, firstRetailer).catch(() => setImp({ status: 'failed', error: '' })); };
  const say = (m: string) => { setToast(m); setTimeout(() => setToast(null), 1400); };

  useEffect(() => { api.memory(household.id).then(setMemory).catch(() => null); }, [api, household.id]);
  // Deals across every store nearby — not only the connected ones. You can
  // browse and compare everything; connecting is only needed to buy.
  const [deals, setDeals] = useState<Deal[]>([]);
  const dealsRef = useRef<ScrollView | null>(null);
  useEffect(() => { api.deals(household.id).then((r) => setDeals(r.deals)).catch(() => setDeals([])); }, [api, household.id]);
  useEffect(() => {
    api.suggest(household.id, lines.map(({ id: _i, imageUrl: _u, productName: _n, ...l }) => l)).then((r) => setSuggestions(r.suggestions)).catch(() => setSuggestions([]));
  }, [lines, api, household.id]);

  // Debounced search while typing. Only where a catalogue exists.
  useEffect(() => {
    const q = query.trim();
    if (!pricing || q.length < 2) { setHits(null); setSearching(false); return; }
    const mine = ++seq.current;
    setSearching(true);
    const h = setTimeout(() => {
      api.search(household.id, q).then(async (r) => {
        if (mine !== seq.current) return;
        setHits(r.products); setSearching(false);
        const missing = r.products.filter((h) => !h.imageUrl && h.gtin).map((h) => h.gtin!);
        if (missing.length === 0) return;
        const im = await api.images(household.id, missing).catch(() => null);
        if (im && mine === seq.current) setHits((xs) => (xs ?? []).map((h) => (h.gtin && im.images[h.gtin] ? { ...h, imageUrl: im.images[h.gtin]! } : h)));
      }).catch(() => { if (mine === seq.current) { setHits([]); setSearching(false); } });
    }, 280);
    return () => clearTimeout(h);
  }, [query, api, household.id, pricing]);

  const onList = useMemo(() => new Set(lines.map((l) => l.query.trim().toLowerCase())), [lines]);
  const due = useMemo(() => new Set(suggestions.filter((x) => x.reason === 'overdue').map((x) => x.preference.key)), [suggestions]);
  const usuals: ProductPreference[] = useMemo(() => !memory ? [] :
    Object.values(memory.products)
      .filter((p) => p.orderCount > 0 && !p.excludeFromSuggestions && !onList.has(p.phrase.trim().toLowerCase()))
      .sort((a, b) => Number(due.has(b.key)) - Number(due.has(a.key)) || b.orderCount - a.orderCount)
      .slice(0, 16), [memory, onList, due]);

  const addLine = (l: Omit<Line, 'id'>) => { tap(); setLines((xs) => [...xs, { id: newId(), ...l }]); setQuery(''); setHits(null); say(tr('added')); };
  const lineFromPref = (p: ProductPreference): Omit<Line, 'id'> => ({
    query: p.phrase, productName: p.productName, gtin: p.gtin, ...(p.brand ? { brand: p.brand } : {}),
    ...(p.defaultAmount !== undefined && p.defaultUnit ? { amount: p.defaultAmount, unit: p.defaultUnit } : {}),
    ...(p.defaultPackQty !== undefined ? { packQty: p.defaultPackQty } : {}),
  });
  // One tap for the whole usual shop: everything due plus everything bought
  // at least twice. The family removes the two they don't want.
  const usualShop = () => {
    const picks = usuals.filter((p) => due.has(p.key) || p.orderCount >= 2);
    if (picks.length === 0) return;
    tap();
    setLines((xs) => [...xs, ...picks.map((p) => ({ id: newId(), ...lineFromPref(p) }))]);
    say(tr('addedN', { n: picks.length }));
  };
  const addTyped = () => { const q = query.trim(); if (q) addLine({ query: q }); };
  const addHit = (h: SearchHit) => addLine({ query: h.name, productName: h.name, ...(h.gtin ? { gtin: h.gtin } : {}), ...(h.brand ? { brand: h.brand } : {}), imageUrl: h.imageUrl });
  const addUsual = (p: ProductPreference) => addLine(lineFromPref(p));
  const remove = (id: string) => { tap(); setLines((xs) => xs.filter((x) => x.id !== id)); };
  const bump = (id: string, d: number) => { tap(); setLines((xs) => xs.map((x) => x.id !== id ? x : (x.amount !== undefined && x.unit) ? { ...x, amount: Math.max(0.5, x.amount + d) } : { ...x, packQty: Math.max(1, (x.packQty ?? 1) + d) })); };

  const qtyLabel = (l: Line) => (l.amount !== undefined && l.unit ? `${l.amount} ${l.unit}` : `×${l.packQty ?? 1}`);
  const locale = currentRegion().locale === 'he' ? 'he' : 'en';
  const groups = AISLES.map((a) => ({ a, items: lines.filter((l) => aisleOf(l.query) === a.key) })).filter((g) => g.items.length > 0);
  const showSearch = query.trim().length >= 2 && pricing;

  return (
    <View style={s.screen}>
      <Header title={household.name} subtitle={household.address} action={tr('invite')} onAction={onInvite} />
      <View style={{ paddingHorizontal: 20, paddingBottom: 10 }}>
        <View style={[s.rowStart, { backgroundColor: t.card, borderRadius: 16, paddingHorizontal: 14, borderWidth: 1.5, borderColor: t.line }]}>
          <Icon name="search" size={19} color={t.faint} weight={2.2} />
          <Input placeholder={tr('whatPh')} value={query} onChangeText={setQuery} onSubmitEditing={addTyped} style={{ flex: 1, backgroundColor: 'transparent', borderWidth: 0, fontSize: 17, paddingHorizontal: 8 }} returnKeyType="done" blurOnSubmit={false} autoCorrect={false} />
          {query ? <Pressable onPress={() => setQuery('')} hitSlop={10} style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: t.inkSoft, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: t.muted, fontSize: 13, fontWeight: '700' }}>✕</Text></Pressable> : null}
          {pricing ? <Pressable onPress={() => setScanning(true)} hitSlop={10} style={{ backgroundColor: t.accentSoft, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12, marginLeft: 4 }}><Text style={[s.link, { fontSize: 13 }]}>{tr('scan')}</Text></Pressable> : null}
        </View>
      </View>
      {scanning ? (
        <Scanner
          onClose={() => setScanning(false)}
          onScan={(gtin) => {
            setScanning(false);
            api.lookup(household.id, gtin).then((r) => { const h = r.products[0]; if (h) addHit(h); else addLine({ query: gtin, gtin }); }).catch(() => addLine({ query: gtin, gtin }));
          }}
        />
      ) : null}
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16 }} keyboardShouldPersistTaps="handled">

        {showSearch ? (
          <View style={[s.card, { paddingVertical: 6 }]}>
            {searching && !hits ? <Text style={[s.small, { paddingVertical: 10 }]}>{tr('searching')}</Text> : null}
            {(hits ?? []).map((h) => (
              <Pressable key={h.productId} onPress={() => addHit(h)} style={({ pressed }) => [s.row, { paddingVertical: 9, borderTopWidth: 1, borderColor: t.line }, pressed && { opacity: 0.6 }]}>
                <View style={[s.rowStart, { flex: 1, gap: 12 }]}>
                  <ProductImage url={h.imageUrl} gtin={h.gtin} name={h.name} size={52} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.body, { fontSize: 15 }]} numberOfLines={2}>{h.name}</Text>
                    <View style={[s.rowStart, { marginTop: 3 }]}>
                      {h.brand ? <Chip text={h.brand} tone="good" /> : null}
                      {h.sizeQty ? <Text style={s.faint}>{h.sizeQty}{h.sizeUnit}</Text> : null}
                    </View>
                  </View>
                </View>
                <View style={{ alignItems: rtl ? 'flex-start' : 'flex-end' }}>
                  {h.fromPrice !== undefined ? <Text style={s.price}>{money(h.fromPrice)}</Text> : null}
                  {h.unitPrice !== undefined ? <Text style={s.faint}>{money(h.unitPrice)}/{(h.unitBasis ?? '').replace('per_', '')}</Text> : null}
                </View>
              </Pressable>
            ))}
            {hits && hits.length === 0 ? <Text style={[s.small, { paddingVertical: 10 }]}>{tr('noResults')}</Text> : null}
            <Pressable onPress={addTyped} style={{ paddingVertical: 10, borderTopWidth: 1, borderColor: t.line }}><Text style={s.link}>{tr('addAsTyped', { q: query.trim() })}</Text></Pressable>
          </View>
        ) : null}

        {!showSearch && firstRetailer && (!memory || Object.keys(memory.products).length === 0) && imp?.status !== 'done' && (
          <View style={[s.card, { backgroundColor: t.accentSoft }]}>
            <Text style={[s.title, { color: t.accent, fontSize: 17 }]}>{tr('connectTitle', { r: firstRetailer })}</Text>
            <Text style={[s.small, { marginBottom: 10 }]}>{tr('connectSub')}</Text>
            <Text style={[s.faint, { fontFamily: 'Menlo', marginBottom: 10 }]}>KANILI_HOUSEHOLD={household.id} npm run link -w @fca/order-worker</Text>
            {imp && ['queued', 'connecting', 'reading', 'resolving'].includes(imp.status) ? <Text style={s.small}>{tr('importing')}</Text>
              : imp?.status === 'failed' ? <Text style={[s.small, { color: t.red }]}>{/no saved session/.test(imp.error ?? '') ? tr('importNeedsLink') : tr('importFailed', { e: imp.error ?? '' })}</Text>
              : <Button title={tr('importBtn')} kind="secondary" onPress={startImport} />}
          </View>
        )}
        {!showSearch && imp?.status === 'done' && (imp.orders ?? 0) > 0 && lines.length === 0 && Object.keys(memory?.products ?? {}).length > 0 && (
          <Text style={[s.small, { marginBottom: 8 }]}>{tr('importDone', { o: imp.orders ?? 0, p: imp.products ?? 0 })}</Text>
        )}
        {!showSearch && lines.length === 0 && usuals.filter((p) => due.has(p.key) || p.orderCount >= 2).length >= 5 && (
          <Pressable onPress={usualShop} style={({ pressed }) => [s.card, { backgroundColor: t.accent, marginBottom: 14 }, pressed && { opacity: 0.85 }]}>
            <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800', textAlign: rtl ? 'right' : 'left' }}>{tr('usualShopN', { n: usuals.filter((p) => due.has(p.key) || p.orderCount >= 2).length })}</Text>
            <Text style={{ color: '#D9EBDF', marginTop: 4, textAlign: rtl ? 'right' : 'left' }}>{tr('usualsHint')}</Text>
          </Pressable>
        )}
        {!showSearch && usuals.length > 0 && (
          <View style={{ marginBottom: 14 }}>
            <View style={s.row}><Text style={s.title}>{tr('usuals')}</Text><Text style={s.faint}>{tr('usualsHint')}</Text></View>
            <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
              {usuals.map((p) => {
                const isDue = due.has(p.key);
                return (
                  <Pressable key={p.key} onPress={() => addUsual(p)} style={({ pressed }) => [{ backgroundColor: isDue ? t.amberSoft : t.card, borderRadius: 14, padding: 8, paddingRight: 12, paddingLeft: 12, borderWidth: 1, borderColor: isDue ? '#EFDDB6' : t.line, flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 8 }, pressed && { opacity: 0.6 }]}>
                    <ProductImage gtin={p.gtin} name={p.phrase} size={34} radius={8} />
                    <View>
                      <Text style={{ fontSize: 15, fontWeight: '600', color: isDue ? t.amber : t.ink }}>{p.phrase}</Text>
                      {p.brand ? <Text style={s.faint}>{p.brand}</Text> : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {!showSearch && deals.length > 0 && (
          <View style={{ marginBottom: 14, marginHorizontal: -20 }}>
            <View style={[s.row, { paddingHorizontal: 20 }]}>
              <View style={s.rowStart}><Icon name="tag" size={18} color={t.ink} /><Text style={s.title}>{tr('dealsNear')}</Text></View>
              <Text style={s.faint}>{tr('dealsNearSub')}</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 10, paddingVertical: 10, flexDirection: rtl ? 'row-reverse' : 'row' }}
              {...carouselProps} ref={(r) => { dealsRef.current = r; }} onContentSizeChange={() => { if (rtl) dealsRef.current?.scrollToEnd({ animated: false }); }}>
              {deals.slice(0, 20).map((d) => {
                const on = onList.has(d.name.trim().toLowerCase());
                return (
                  <Pressable key={`${d.gtin}-${d.chainName}`} disabled={on} onPress={() => addLine({ query: d.name, productName: d.name, gtin: d.gtin, ...(d.brand ? { brand: d.brand } : {}), imageUrl: d.imageUrl ?? undefined })}
                    style={({ pressed }) => [{ width: 150, backgroundColor: t.card, borderRadius: 18, padding: 10, borderWidth: 1, borderColor: d.usual ? t.accent2 : t.line }, (pressed || on) && { opacity: 0.55 }]}>
                    <View style={{ alignItems: 'center' }}><ProductImage url={d.imageUrl} gtin={d.gtin} name={d.name} size={96} radius={12} /></View>
                    <View style={{ position: 'absolute', top: 8, [rtl ? 'right' : 'left']: 8, backgroundColor: t.ink, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 }}>
                      <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>-{Math.round(d.discountRate)}%</Text>
                    </View>
                    {d.usual ? <View style={{ position: 'absolute', top: 8, [rtl ? 'left' : 'right']: 8 }}><Icon name="star" size={14} color={t.accent} /></View> : null}
                    <Text style={[s.body, { fontSize: 13, lineHeight: 17, marginTop: 8, minHeight: 34 }]} numberOfLines={2}>{d.name}</Text>
                    <View style={[s.row, { marginTop: 6 }]}>
                      <Text style={[s.price, { fontSize: 17 }]}>{money(d.price)}</Text>
                      <Text style={[s.faint, { fontSize: 11 }]} numberOfLines={1}>{d.chainName}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}

        {!showSearch && (lines.length === 0 ? <Empty title={tr('emptyTitle')} hint={tr('emptyHint')} /> : groups.map(({ a, items }) => (
          <View key={a.key} style={[s.card, { paddingVertical: 8 }]}>
            <Text style={[s.small, { fontWeight: '700', color: t.muted, paddingVertical: 6 }]}>{a.glyph}  {a[locale]}</Text>
            {items.map((item) => (
              <View key={item.id} style={[s.row, { paddingVertical: 8, borderTopWidth: 1, borderColor: t.line }]}>
                <View style={[s.rowStart, { flex: 1, gap: 10 }]}>
                  <Pressable onPress={() => remove(item.id)} hitSlop={14} style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: t.line, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="check" size={14} color={t.faint} />
                  </Pressable>
                  <ProductImage url={item.imageUrl} gtin={item.gtin} name={item.query} size={40} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.body, { fontSize: 16 }]} numberOfLines={1}>{item.query}</Text>
                    {item.brand ? <Text style={s.faint}>{item.brand}</Text> : null}
                  </View>
                </View>
                <View style={[s.rowStart, { gap: 0, backgroundColor: t.inkSoft, borderRadius: 999 }]}>
                  <Pressable onPress={() => bump(item.id, -1)} hitSlop={10} style={{ paddingHorizontal: 12, paddingVertical: 9 }}><Icon name="minus" size={16} color={t.muted} /></Pressable>
                  <Text style={[s.priceSmall, { color: t.ink, minWidth: 40, textAlign: 'center', fontWeight: '700' }]}>{qtyLabel(item)}</Text>
                  <Pressable onPress={() => bump(item.id, 1)} hitSlop={10} style={{ paddingHorizontal: 12, paddingVertical: 9 }}><Icon name="plus" size={16} color={t.ink} /></Pressable>
                </View>
              </View>
            ))}
          </View>
        )))}
      </ScrollView>

      <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: Platform.OS === 'web' ? 96 : 88, backgroundColor: t.card, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: t.line, shadowColor: '#0E2E1F', shadowOpacity: 0.08, shadowRadius: 20, shadowOffset: { width: 0, height: -6 } }}>
        {query.trim() ? (
          <Button title={tr('addAsTyped', { q: query.trim() })} kind="secondary" icon="plus" onPress={addTyped} />
        ) : (
          <View style={[s.rowStart, { gap: 10 }]}>
            {/* Buying mode: set here, remembered, and the compare screen opens in it. */}
            <Pressable onPress={() => { tap(); setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]!); }} hitSlop={8}
              style={{ backgroundColor: t.inkSoft, borderRadius: 999, paddingVertical: 14, paddingHorizontal: 14, flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 6 }}>
              <Icon name="sliders" size={16} color={t.ink} />
              <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14 }}>{tr(`mode_${mode}`)}</Text>
            </Pressable>
            <Button title={lines.length === 0 ? tr('compare') : tr('compareN', { n: lines.length })} icon={lines.length ? 'basket' : undefined} onPress={() => onQuote(lines)} disabled={lines.length === 0 || !pricing} style={{ flex: 1 }} />
          </View>
        )}
      </View>
      <Toast text={toast} />
    </View>
  );
}
