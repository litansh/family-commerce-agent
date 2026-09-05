import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { HouseholdMemory, ProductPreference, Suggestion } from '@fca/domain';
import type { Api, Household } from '../lib/api';
import { AISLES, aisleOf } from '../lib/categories';
import { currentRegion, isRTL, t as tr } from '../lib/i18n';
import { loadList, newId, saveList, type Line } from '../lib/store';
import { Button, Chip, Empty, Header, Input, S, t } from '../ui';

/**
 * The shared list.
 *
 * Three ideas borrowed from the best list apps, bent toward what Kanili knows:
 *  - your usuals as one-tap tiles (Bring!), but drawn from the household's own
 *    memory, ranked by how often they buy it, amber when it is about due
 *  - the list grouped by aisle (AnyList), so 40 lines stay scannable
 *  - quantity inline, one tap to bump
 */
export function ListScreen({ api, household, onQuote, onInvite }: {
  api: Api; household: Household; onQuote: (lines: Line[]) => void; onInvite: () => void;
}) {
  const s = S();
  const rtl = isRTL();
  const [lines, setLines] = useState<Line[]>([]);
  const [query, setQuery] = useState('');
  const [brand, setBrand] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [memory, setMemory] = useState<HouseholdMemory | null>(null);

  useEffect(() => { void loadList().then(setLines); api.memory(household.id).then(setMemory).catch(() => null); }, [api, household.id]);
  useEffect(() => {
    void saveList(lines);
    api.suggest(household.id, lines.map(({ id: _i, ...l }) => l)).then((r) => setSuggestions(r.suggestions)).catch(() => setSuggestions([]));
  }, [lines, api, household.id]);

  const onList = useMemo(() => new Set(lines.map((l) => l.query.trim().toLowerCase())), [lines]);
  const due = useMemo(() => new Set(suggestions.filter((x) => x.reason === 'overdue').map((x) => x.preference.key)), [suggestions]);

  // Usuals: everything the household has bought, most-bought first, not already listed.
  const usuals: ProductPreference[] = useMemo(() => {
    if (!memory) return [];
    return Object.values(memory.products)
      .filter((p) => p.orderCount > 0 && !p.excludeFromSuggestions && !onList.has(p.phrase.trim().toLowerCase()))
      .sort((a, b) => Number(due.has(b.key)) - Number(due.has(a.key)) || b.orderCount - a.orderCount)
      .slice(0, 16);
  }, [memory, onList, due]);

  const add = (q: string, b?: string, pref?: ProductPreference) => {
    const txt = q.trim();
    if (!txt) return;
    setLines((xs) => [...xs, {
      id: newId(), query: txt,
      ...(b?.trim() ? { brand: b.trim() } : {}),
      ...(pref?.defaultAmount !== undefined && pref.defaultUnit ? { amount: pref.defaultAmount, unit: pref.defaultUnit } : {}),
      ...(pref?.defaultPackQty !== undefined ? { packQty: pref.defaultPackQty } : {}),
    }]);
    setQuery(''); setBrand('');
  };
  const remove = (id: string) => setLines((xs) => xs.filter((x) => x.id !== id));
  const bump = (id: string, d: number) =>
    setLines((xs) => xs.map((x) => {
      if (x.id !== id) return x;
      if (x.amount !== undefined && x.unit) return { ...x, amount: Math.max(0.5, x.amount + d) };
      return { ...x, packQty: Math.max(1, (x.packQty ?? 1) + d) };
    }));

  const qtyLabel = (l: Line) => (l.amount !== undefined && l.unit ? `${l.amount} ${l.unit}` : `×${l.packQty ?? 1}`);
  const locale = currentRegion().locale === 'he' ? 'he' : 'en';
  const groups = AISLES.map((a) => ({ a, items: lines.filter((l) => aisleOf(l.query) === a.key) })).filter((g) => g.items.length > 0);

  return (
    <View style={s.screen}>
      <Header title={household.name} subtitle={household.address} action={tr('invite')} onAction={onInvite} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16 }} keyboardShouldPersistTaps="handled">

        {usuals.length > 0 && (
          <View style={{ marginBottom: 14 }}>
            <View style={s.row}>
              <Text style={s.title}>{tr('usuals')}</Text>
              <Text style={s.faint}>{tr('usualsHint')}</Text>
            </View>
            <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
              {usuals.map((p) => {
                const isDue = due.has(p.key);
                return (
                  <Pressable key={p.key} onPress={() => add(p.phrase, p.brand, p)}
                    style={({ pressed }) => [{ backgroundColor: isDue ? t.amberSoft : t.card, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: isDue ? '#EFDDB6' : t.line }, pressed && { opacity: 0.6 }]}>
                    <Text style={{ fontSize: 15, fontWeight: '600', color: isDue ? t.amber : t.ink }}>{AISLES.find((a) => a.key === aisleOf(p.phrase))?.glyph} {p.phrase}</Text>
                    {p.brand ? <Text style={[s.faint, { marginTop: 2 }]}>{p.brand}</Text> : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {suggestions.length > 0 && usuals.length === 0 && (
          <View style={[s.card, { backgroundColor: t.amberSoft }]}>
            <Text style={[s.title, { color: t.amber, fontSize: 17 }]}>{tr('forgot')}</Text>
            {suggestions.slice(0, 5).map((sg) => (
              <Pressable key={sg.preference.key} onPress={() => add(sg.preference.phrase, sg.preference.brand, sg.preference)} style={[s.row, { paddingVertical: 8 }]}>
                <Text style={s.body}>{sg.preference.phrase}</Text>
                <Text style={[s.small, { color: t.amber }]}>{sg.reason === 'overdue' ? tr('everyDays', { n: sg.usualIntervalDays ?? '', d: sg.daysSince }) : tr('boughtTimes', { n: sg.preference.orderCount })}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {lines.length === 0 ? <Empty title={tr('emptyTitle')} hint={tr('emptyHint')} /> : groups.map(({ a, items }) => (
          <View key={a.key} style={[s.card, { paddingVertical: 8 }]}>
            <Text style={[s.small, { fontWeight: '700', color: t.muted, paddingVertical: 6 }]}>{a.glyph}  {a[locale]}</Text>
            {items.map((item) => (
              <View key={item.id} style={[s.row, { paddingVertical: 10, borderTopWidth: 1, borderColor: t.line }]}>
                <View style={[s.rowStart, { flex: 1 }]}>
                  <Pressable onPress={() => remove(item.id)} hitSlop={12} style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: t.accent, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: t.accent, fontSize: 13, fontWeight: '800' }}>✓</Text>
                  </Pressable>
                  <Text style={[s.body, { fontSize: 17, flexShrink: 1 }]}>{item.query}</Text>
                  {item.brand ? <Chip text={item.brand} tone="good" /> : null}
                </View>
                <View style={[s.rowStart, { gap: 0, backgroundColor: t.bg, borderRadius: 999 }]}>
                  <Pressable onPress={() => bump(item.id, -1)} hitSlop={8} style={{ paddingHorizontal: 12, paddingVertical: 6 }}><Text style={{ color: t.muted, fontSize: 18 }}>−</Text></Pressable>
                  <Text style={[s.priceSmall, { color: t.ink, minWidth: 44, textAlign: 'center' }]}>{qtyLabel(item)}</Text>
                  <Pressable onPress={() => bump(item.id, 1)} hitSlop={8} style={{ paddingHorizontal: 12, paddingVertical: 6 }}><Text style={{ color: t.accent, fontSize: 18 }}>+</Text></Pressable>
                </View>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>

      <View style={{ padding: 16, paddingBottom: 20, backgroundColor: t.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 16, shadowOffset: { width: 0, height: -4 } }}>
        <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', gap: 8 }}>
          <Input placeholder={tr('whatPh')} value={query} onChangeText={setQuery} onSubmitEditing={() => add(query, brand)} style={{ flex: 2, backgroundColor: t.bg, borderWidth: 0 }} returnKeyType="done" blurOnSubmit={false} />
          <Input placeholder={tr('brandPh')} value={brand} onChangeText={setBrand} onSubmitEditing={() => add(query, brand)} style={{ flex: 1, backgroundColor: t.bg, borderWidth: 0 }} />
        </View>
        <View style={{ height: 10 }} />
        {query.trim() ? (
          <Button title={tr('add', { q: query.trim() })} kind="secondary" onPress={() => add(query, brand)} />
        ) : (
          <Button title={lines.length === 0 ? tr('compare') : tr('compareN', { n: lines.length })} onPress={() => onQuote(lines)} disabled={lines.length === 0} />
        )}
      </View>
    </View>
  );
}
