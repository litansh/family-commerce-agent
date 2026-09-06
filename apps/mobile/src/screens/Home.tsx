import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { HouseholdMemory, ProductPreference, Suggestion } from '@fca/domain';
import type { Api, Deal, Household } from '../lib/api';
import { AISLES, aisleOf } from '../lib/categories';
import { currentRegion, isRTL, money, t as tr } from '../lib/i18n';
import { addLine, newId, setLines, useList } from '../lib/store';
import { ProductImage } from '../ProductImage';
import { Button, GRAD_INK, GradientCard, Header, Icon, S, t, Toast } from '../ui';

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
  const [imp, setImp] = useState<{ status: string; orders?: number; products?: number; error?: string } | null>(null);
  const firstRetailer = household.retailers?.[0];
  const retailerName: Record<string, string> = { shufersal: 'שופרסל', 'rami-levy': 'רמי לוי', victory: 'ויקטורי', carrefour: 'קרפור', yochananof: 'יוחננוף', 'tiv-taam': 'טיב טעם' };
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
  const locale = currentRegion().locale === 'he' ? 'he' : 'en';

  useEffect(() => { api.memory(household.id).then(setMemory).catch(() => null); }, [api, household.id]);
  // Deals from every store nearby, the household's products first. Home is
  // a store window, not a menu: there is always something to look at.
  const [deals, setDeals] = useState<Deal[]>([]);
  useEffect(() => { api.deals(household.id).then((r) => setDeals(r.deals)).catch(() => setDeals([])); }, [api, household.id]);
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
      <ScrollView contentContainerStyle={{ paddingBottom: 130 }} showsVerticalScrollIndicator={false}>
        <Header title={tr('hello', { n: household.name })} subtitle={household.address} />
        <View style={{ paddingHorizontal: 20 }}>
          {shop.length >= 3 && (
            <GradientCard colors={GRAD_INK} style={{ marginBottom: 14, padding: 22 }} onPress={() => { tap(); setLines((xs) => [...xs, ...shop.map((p) => ({ id: newId(), ...lineFromPref(p) }))]); say(tr('addedN', { n: shop.length })); onList(); }}>
              <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <Icon name="spark" size={15} color={t.accent2} />
                <Text style={{ color: t.accent2, fontWeight: '700', fontSize: 12.5, letterSpacing: 0.3 }}>{tr('usualsHint')}</Text>
              </View>
              <Text style={{ color: '#fff', fontSize: 26, fontWeight: '800', textAlign: rtl ? 'right' : 'left', letterSpacing: -0.6, lineHeight: 32 }}>{tr('usualShopN', { n: shop.length })}</Text>
              <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 6, marginTop: 14 }}>
                <Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 14, fontWeight: '600' }}>{tr('tabList')}</Text>
                <Icon name="arrow" size={16} color="rgba(255,255,255,0.72)" />
              </View>
            </GradientCard>
          )}
          {firstRetailer && memory && Object.keys(memory.products).length === 0 && imp?.status !== 'done' && (
            <View style={[s.card, { backgroundColor: t.accentSoft }]}>
              <Text style={[s.title, { color: t.accent, fontSize: 17 }]}>{tr('connectTitle', { r: retailerName[firstRetailer] ?? firstRetailer })}</Text>
              <Text style={[s.small, { marginVertical: 8 }]}>{tr('connectSub')}</Text>
              {imp && ['queued', 'connecting', 'reading', 'resolving'].includes(imp.status) ? <Text style={s.small}>{tr('importing')}</Text>
                : imp?.status === 'failed' ? <Text style={[s.small, { color: t.red }]}>{/no saved session/.test(imp.error ?? '') ? tr('importNeedsLink') : tr('importFailed', { e: imp.error ?? '' })}</Text>
                : <Button title={tr('importBtn')} kind="secondary" onPress={startImport} />}
            </View>
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
          {deals.length > 0 && (
            <View style={{ marginBottom: 6, marginHorizontal: -20 }}>
              <View style={[s.row, { paddingHorizontal: 20 }]}>
                <View style={s.rowStart}><Icon name="tag" size={18} color={t.ink} /><Text style={s.title}>{tr('dealsNear')}</Text></View>
                <Text style={s.faint}>{tr('dealsNearSub')}</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 10, paddingVertical: 10, flexDirection: rtl ? 'row-reverse' : 'row' }}>
                {deals.slice(0, 14).map((d) => (
                  <Pressable key={`${d.gtin}-${d.chainName}`} onPress={() => { addLine({ query: d.name, productName: d.name, gtin: d.gtin, ...(d.brand ? { brand: d.brand } : {}), imageUrl: d.imageUrl ?? undefined }); tap(); say(tr('added')); }}
                    style={({ pressed }) => [{ width: 148, backgroundColor: t.card, borderRadius: 18, padding: 10, borderWidth: 1, borderColor: d.usual ? t.accent2 : t.line }, pressed && { opacity: 0.6 }]}>
                    <View style={{ alignItems: 'center' }}><ProductImage url={d.imageUrl} gtin={d.gtin} name={d.name} size={96} radius={12} /></View>
                    <View style={{ position: 'absolute', top: 8, [rtl ? 'right' : 'left']: 8, backgroundColor: t.ink, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 }}>
                      <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>-{Math.round(d.discountRate)}%</Text>
                    </View>
                    {d.usual ? <View style={{ position: 'absolute', top: 8, [rtl ? 'left' : 'right']: 8 }}><Icon name="star" size={14} color={t.accent} /></View> : null}
                    <Text style={[s.body, { fontSize: 13, lineHeight: 17, marginTop: 8, minHeight: 34 }]} numberOfLines={2}>{d.name}</Text>
                    <View style={[s.row, { marginTop: 6 }]}>
                      <Text style={[s.price, { fontSize: 17 }]}>{money(d.price)}</Text>
                      <Text style={[s.faint, { fontSize: 11, flexShrink: 1 }]} numberOfLines={1}>{d.chainName}</Text>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}
          <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, marginBottom: 12 }}>
            <Text style={s.title}>{tr('aisles')}</Text>
            <Pressable onPress={onList} hitSlop={8} style={{ flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 3 }}>
              <Text style={s.link}>{tr('tabList')}</Text>
              <Icon name="chevron" size={13} color={t.accent} weight={2.6} />
            </Pressable>
          </View>
          <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', flexWrap: 'wrap', gap: 12 }}>
            {AISLES.filter((a) => a.key !== 'other').map((a) => (
              <Pressable key={a.key} onPress={() => { tap(); onAisle(a.key); }} style={({ pressed }) => [{ width: '30.7%', flexGrow: 1, backgroundColor: t.card, borderRadius: 20, paddingVertical: 18, paddingHorizontal: 8, alignItems: 'center', borderWidth: 1, borderColor: t.line }, pressed && { opacity: 0.7, transform: [{ scale: 0.97 }] }]}>
                <View style={{ width: 54, height: 54, borderRadius: 18, backgroundColor: a.tint, alignItems: 'center', justifyContent: 'center', marginBottom: 9 }}>
                  <Text style={{ fontSize: 27 }}>{a.glyph}</Text>
                </View>
                <Text style={{ color: t.ink, fontWeight: '700', fontSize: 12.5, marginTop: 0, textAlign: 'center', letterSpacing: -0.2 }} numberOfLines={2}>{a[locale]}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
      <Toast text={toast} />
    </View>
  );
}
