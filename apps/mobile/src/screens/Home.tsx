import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { HouseholdMemory, ProductPreference, Suggestion } from '@fca/domain';
import type { Api, Household } from '../lib/api';
import { AISLES, aisleOf } from '../lib/categories';
import { currentRegion, isRTL, t as tr } from '../lib/i18n';
import { addLine, newId, setLines, useList } from '../lib/store';
import { ProductImage } from '../ProductImage';
import { Header, S, t, Toast } from '../ui';

const tap = () => { if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

/**
 * Home: the one screen a family opens on a Thursday evening.
 * The usual shop in one tap, what they forgot, and the aisles to browse.
 */
export function HomeScreen({ api, household, onAisle, onList }: { api: Api; household: Household; onAisle: (aisle: string) => void; onList: () => void }) {
  const s = S();
  const rtl = isRTL();
  const lines = useList();
  const [memory, setMemory] = useState<HouseholdMemory | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const say = (m: string) => { setToast(m); setTimeout(() => setToast(null), 1400); };
  const locale = currentRegion().locale === 'he' ? 'he' : 'en';

  useEffect(() => { api.memory(household.id).then(setMemory).catch(() => null); }, [api, household.id]);
  useEffect(() => { api.suggest(household.id, lines.map(({ id: _i, imageUrl: _u, productName: _n, ...l }) => l)).then((r) => setSuggestions(r.suggestions)).catch(() => setSuggestions([])); }, [lines, api, household.id]);

  const onList_ = useMemo(() => new Set(lines.map((l) => l.query.trim().toLowerCase())), [lines]);
  const due = useMemo(() => new Set(suggestions.filter((x) => x.reason === 'overdue').map((x) => x.preference.key)), [suggestions]);
  const usuals: ProductPreference[] = useMemo(() => !memory ? [] :
    Object.values(memory.products).filter((p) => p.orderCount > 0 && !p.excludeFromSuggestions && !onList_.has(p.phrase.trim().toLowerCase()))
      .sort((a, b) => Number(due.has(b.key)) - Number(due.has(a.key)) || b.orderCount - a.orderCount), [memory, onList_, due]);
  const shop = usuals.filter((p) => due.has(p.key) || p.orderCount >= 2);
  const lineFromPref = (p: ProductPreference) => ({ query: p.phrase, productName: p.productName, gtin: p.gtin, ...(p.brand ? { brand: p.brand } : {}), ...(p.defaultAmount !== undefined && p.defaultUnit ? { amount: p.defaultAmount, unit: p.defaultUnit } : {}), ...(p.defaultPackQty !== undefined ? { packQty: p.defaultPackQty } : {}) });

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <Header title={tr('hello', { n: household.name })} subtitle={household.address} />
        <View style={{ paddingHorizontal: 20 }}>
          {shop.length >= 3 && (
            <Pressable onPress={() => { tap(); setLines((xs) => [...xs, ...shop.map((p) => ({ id: newId(), ...lineFromPref(p) }))]); say(tr('addedN', { n: shop.length })); onList(); }}
              style={({ pressed }) => [s.card, { backgroundColor: t.accent }, pressed && { opacity: 0.85 }]}>
              <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800', textAlign: rtl ? 'right' : 'left' }}>{tr('usualShopN', { n: shop.length })}</Text>
              <Text style={{ color: '#D9EBDF', marginTop: 4, textAlign: rtl ? 'right' : 'left' }}>{tr('usualsHint')}</Text>
            </Pressable>
          )}
          {suggestions.length > 0 && (
            <View style={[s.card, { backgroundColor: t.amberSoft }]}>
              <Text style={[s.title, { color: t.amber, fontSize: 17 }]}>{tr('forgot')}</Text>
              <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                {suggestions.slice(0, 8).map((sg) => (
                  <Pressable key={sg.preference.key} onPress={() => { addLine(lineFromPref(sg.preference)); tap(); say(tr('added')); }}
                    style={{ backgroundColor: '#fff', borderRadius: 14, padding: 8, paddingHorizontal: 12, flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 8 }}>
                    <ProductImage gtin={sg.preference.gtin} name={sg.preference.phrase} size={30} radius={8} />
                    <Text style={{ fontWeight: '600', color: t.amber }}>{sg.preference.phrase}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
          <Text style={[s.title, { marginTop: 8, marginBottom: 10 }]}>{tr('aisles')}</Text>
          <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', flexWrap: 'wrap', gap: 10 }}>
            {AISLES.filter((a) => a.key !== 'other').map((a) => (
              <Pressable key={a.key} onPress={() => onAisle(a.key)} style={({ pressed }) => [{ width: '30%', flexGrow: 1, backgroundColor: t.card, borderRadius: 16, paddingVertical: 16, alignItems: 'center' }, pressed && { opacity: 0.7 }]}>
                <Text style={{ fontSize: 30 }}>{a.glyph}</Text>
                <Text style={[s.small, { color: t.ink, fontWeight: '600', marginTop: 6, textAlign: 'center' }]}>{a[locale]}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
      <Toast text={toast} />
    </View>
  );
}
