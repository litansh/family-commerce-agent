import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { Api, Household, SearchHit } from '../lib/api';
import { AISLES } from '../lib/categories';
import { currentRegion, isRTL, money, t as tr } from '../lib/i18n';
import { addLine, useList } from '../lib/store';
import { ProductImage } from '../ProductImage';
import { Chip, Header, S, Skeleton, t, Toast } from '../ui';

const tap = () => { if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

/** An aisle as a store shows it: a grid of photo cards, the price at every chain, one tap to add. */
export function AisleScreen({ api, household, aisle, onBack }: { api: Api; household: Household; aisle: string; onBack: () => void }) {
  const s = S();
  const rtl = isRTL();
  const lines = useList();
  const [products, setProducts] = useState<SearchHit[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const locale = currentRegion().locale === 'he' ? 'he' : 'en';
  const meta = AISLES.find((a) => a.key === aisle);
  useEffect(() => { setProducts(null); api.browse(household.id, aisle).then((r) => setProducts(r.products)).catch(() => setProducts([])); }, [api, household.id, aisle]);
  const inList = useMemo(() => new Set(lines.map((l) => l.gtin).filter(Boolean)), [lines]);
  const add = (h: SearchHit) => { tap(); addLine({ query: h.name, productName: h.name, ...(h.gtin ? { gtin: h.gtin } : {}), ...(h.brand ? { brand: h.brand } : {}), imageUrl: h.imageUrl }); setToast(tr('added')); setTimeout(() => setToast(null), 1200); };

  return (
    <View style={s.screen}>
      <Header title={`${meta?.glyph ?? ''} ${meta?.[locale] ?? aisle}`} onBack={onBack} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}>
        {!products ? <><Skeleton /><Skeleton /><Skeleton /></> : (
          <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', flexWrap: 'wrap', gap: 10 }}>
            {products.map((h) => {
              const have = !!h.gtin && inList.has(h.gtin);
              return (
                <View key={h.productId} style={[s.card, { width: '47%', flexGrow: 1, marginBottom: 0, padding: 12 }]}>
                  <View style={{ alignItems: 'center', marginBottom: 8 }}><ProductImage url={h.imageUrl} gtin={h.gtin} name={h.name} size={96} radius={14} /></View>
                  <Text style={[s.body, { fontSize: 14, lineHeight: 19, minHeight: 38 }]} numberOfLines={2}>{h.name}</Text>
                  <View style={[s.rowStart, { marginTop: 4 }]}>{h.brand ? <Chip text={h.brand} tone="good" /> : null}</View>
                  <View style={[s.row, { marginTop: 8, alignItems: 'flex-end' }]}>
                    <View>
                      {h.fromPrice !== undefined ? <Text style={s.price}>{money(h.fromPrice)}</Text> : null}
                      {h.pricedAtChains > 1 ? <Text style={s.faint}>{tr('from')} · {tr('atChains', { n: h.pricedAtChains })}</Text> : null}
                    </View>
                    <Pressable onPress={() => add(h)} disabled={have} hitSlop={8} style={{ backgroundColor: have ? t.accentSoft : t.accent, borderRadius: 999, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: have ? t.accent : '#fff', fontSize: 20, fontWeight: '800' }}>{have ? '✓' : '+'}</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
      <Toast text={toast} />
    </View>
  );
}
