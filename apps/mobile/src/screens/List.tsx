import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { HouseholdMemory, ProductPreference, Suggestion } from '@fca/domain';
import type { Api, Household, SearchHit } from '../lib/api';
import { AISLES, aisleOf } from '../lib/categories';
import { currentRegion, isRTL, money, t as tr } from '../lib/i18n';
import { loadList, newId, saveList, type Line } from '../lib/store';
import { ProductImage } from '../ProductImage';
import { Scanner } from '../Scanner';
import { Button, Chip, Empty, Header, Input, S, t } from '../ui';

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
  const [lines, setLines] = useState<Line[]>([]);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [memory, setMemory] = useState<HouseholdMemory | null>(null);
  const pricing = currentRegion().pricingAvailable;
  const seq = useRef(0);
  const [scanning, setScanning] = useState(false);

  useEffect(() => { void loadList().then(setLines); api.memory(household.id).then(setMemory).catch(() => null); }, [api, household.id]);
  useEffect(() => {
    void saveList(lines);
    api.suggest(household.id, lines.map(({ id: _i, imageUrl: _u, productName: _n, ...l }) => l)).then((r) => setSuggestions(r.suggestions)).catch(() => setSuggestions([]));
  }, [lines, api, household.id]);

  // Debounced search while typing. Only where a catalogue exists.
  useEffect(() => {
    const q = query.trim();
    if (!pricing || q.length < 2) { setHits(null); setSearching(false); return; }
    const mine = ++seq.current;
    setSearching(true);
    const h = setTimeout(() => {
      api.search(household.id, q).then((r) => { if (mine === seq.current) { setHits(r.products); setSearching(false); } }).catch(() => { if (mine === seq.current) { setHits([]); setSearching(false); } });
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

  const addLine = (l: Omit<Line, 'id'>) => { tap(); setLines((xs) => [...xs, { id: newId(), ...l }]); setQuery(''); setHits(null); };
  const addTyped = () => { const q = query.trim(); if (q) addLine({ query: q }); };
  const addHit = (h: SearchHit) => addLine({ query: h.name, productName: h.name, ...(h.gtin ? { gtin: h.gtin } : {}), ...(h.brand ? { brand: h.brand } : {}), imageUrl: h.imageUrl });
  const addUsual = (p: ProductPreference) => addLine({
    query: p.phrase, productName: p.productName, gtin: p.gtin, ...(p.brand ? { brand: p.brand } : {}),
    ...(p.defaultAmount !== undefined && p.defaultUnit ? { amount: p.defaultAmount, unit: p.defaultUnit } : {}),
    ...(p.defaultPackQty !== undefined ? { packQty: p.defaultPackQty } : {}),
  });
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
        <View style={[s.rowStart, { backgroundColor: t.card, borderRadius: 14, paddingHorizontal: 12, borderWidth: 1, borderColor: t.line }]}>
          <Text style={{ fontSize: 18, color: t.faint }}>⌕</Text>
          <Input placeholder={tr('whatPh')} value={query} onChangeText={setQuery} onSubmitEditing={addTyped} style={{ flex: 1, backgroundColor: 'transparent', borderWidth: 0, fontSize: 17, paddingHorizontal: 6 }} returnKeyType="done" blurOnSubmit={false} autoCorrect={false} />
          {query ? <Pressable onPress={() => setQuery('')} hitSlop={10}><Text style={{ color: t.faint, fontSize: 16 }}>✕</Text></Pressable> : null}
          {pricing ? <Pressable onPress={() => setScanning(true)} hitSlop={10} style={{ paddingVertical: 10, paddingHorizontal: 6 }}><Text style={[s.link, { fontSize: 14 }]}>▣ {tr('scan')}</Text></Pressable> : null}
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

        {!showSearch && (lines.length === 0 ? <Empty title={tr('emptyTitle')} hint={tr('emptyHint')} /> : groups.map(({ a, items }) => (
          <View key={a.key} style={[s.card, { paddingVertical: 8 }]}>
            <Text style={[s.small, { fontWeight: '700', color: t.muted, paddingVertical: 6 }]}>{a.glyph}  {a[locale]}</Text>
            {items.map((item) => (
              <View key={item.id} style={[s.row, { paddingVertical: 8, borderTopWidth: 1, borderColor: t.line }]}>
                <View style={[s.rowStart, { flex: 1, gap: 10 }]}>
                  <Pressable onPress={() => remove(item.id)} hitSlop={12} style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: t.accent, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: t.accent, fontSize: 13, fontWeight: '800' }}>✓</Text>
                  </Pressable>
                  <ProductImage url={item.imageUrl} gtin={item.gtin} name={item.query} size={40} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.body, { fontSize: 16 }]} numberOfLines={1}>{item.query}</Text>
                    {item.brand ? <Text style={s.faint}>{item.brand}</Text> : null}
                  </View>
                </View>
                <View style={[s.rowStart, { gap: 0, backgroundColor: t.bg, borderRadius: 999 }]}>
                  <Pressable onPress={() => bump(item.id, -1)} hitSlop={8} style={{ paddingHorizontal: 12, paddingVertical: 6 }}><Text style={{ color: t.muted, fontSize: 18 }}>−</Text></Pressable>
                  <Text style={[s.priceSmall, { color: t.ink, minWidth: 44, textAlign: 'center' }]}>{qtyLabel(item)}</Text>
                  <Pressable onPress={() => bump(item.id, 1)} hitSlop={8} style={{ paddingHorizontal: 12, paddingVertical: 6 }}><Text style={{ color: t.accent, fontSize: 18 }}>+</Text></Pressable>
                </View>
              </View>
            ))}
          </View>
        )))}
      </ScrollView>

      <View style={{ padding: 16, paddingBottom: 20, backgroundColor: t.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 16, shadowOffset: { width: 0, height: -4 } }}>
        {query.trim() ? (
          <Button title={tr('addAsTyped', { q: query.trim() })} kind="secondary" onPress={addTyped} />
        ) : (
          <Button title={lines.length === 0 ? tr('compare') : tr('compareN', { n: lines.length })} onPress={() => onQuote(lines)} disabled={lines.length === 0 || !pricing} />
        )}
      </View>
    </View>
  );
}
