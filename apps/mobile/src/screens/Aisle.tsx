import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { Api, Household, SearchHit } from '../lib/api';
import { AISLES } from '../lib/categories';
import { currentRegion, isRTL, money, t as tr } from '../lib/i18n';
import { addLine, useList } from '../lib/store';
import { ProductImage } from '../ProductImage';
import { Button, Chip, Header, Loading, S, Skeleton, t, Toast } from '../ui';

const tap = () => { if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

const SUB_HE: Record<string, string> = {
  milk: 'חלב', cheese: 'גבינות', yogurt: 'יוגורטים', butter: 'חמאה ושמנת', eggs: 'ביצים',
  vegetables: 'ירקות', fruit: 'פירות', herbs: 'עשבי תיבול',
  bread: 'לחם', pita: 'פיתות ולחמניות', pastry: 'מאפים',
  chicken: 'עוף', beef: 'בקר', fish: 'דגים', deli: 'נקניקים',
  rice_pasta: 'אורז ופסטה', canned: 'שימורים', oils: 'שמנים ורטבים', baking: 'אפייה', breakfast: 'ארוחת בוקר', snacks: 'חטיפים', legumes: 'קטניות',
  frozen_meals: 'מנות קפואות', frozen_veg: 'ירקות קפואים', ice_cream: 'גלידות',
  water_soft: 'מים ומשקאות קלים', juice: 'מיצים', hot: 'קפה ותה', alcohol: 'אלכוהול',
  diapers: 'חיתולים', wipes: 'מגבונים', formula: 'תמ״ל ומזון',
  paper: 'נייר', cleaning: 'ניקיון', laundry: 'כביסה', bags: 'שקיות ואריזה', personal: 'טיפוח',
};
const subName = (k: string, locale: string) => (locale === 'he' ? SUB_HE[k] ?? k : k.replace('_', ' '));

/**
 * An aisle as a store shows it: sub-aisles across the top, a deep grid of
 * photo cards, the best price and how many chains carry each item, one tap
 * to add — and a product sheet listing every chain that stocks it.
 */
export function AisleScreen({ api, household, aisle, onBack }: { api: Api; household: Household; aisle: string; onBack: () => void }) {
  const s = S();
  const rtl = isRTL();
  const lines = useList();
  const locale = currentRegion().locale;
  const [sub, setSub] = useState<string | null>(null);
  const [subs, setSubs] = useState<string[]>([]);
  const [products, setProducts] = useState<SearchHit[] | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [open, setOpen] = useState<SearchHit | null>(null);
  const meta = AISLES.find((a) => a.key === aisle);

  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  // One fetch per (aisle, sub). The first response also names the default
  // sub-aisle; setting it must not trigger a second identical fetch. While a
  // sub-aisle loads, the previous grid stays on screen, dimmed - a blank
  // screen for ten seconds reads as "it disappeared".
  useEffect(() => {
    const mine = ++seq.current;
    setLoading(true); setPage(0);
    api.browse(household.id, aisle, sub ?? undefined, 0)
      .then((r) => {
        if (mine !== seq.current) return;
        setSubs(r.subs); setProducts(r.products); setHasMore(r.hasMore); setTotal(r.total);
        if (sub === null) settleSub(r.sub);
        void hydrateImages(r.products);
      })
      .catch(() => { if (mine === seq.current) setProducts([]); })
      .finally(() => { if (mine === seq.current) setLoading(false); });
  }, [api, household.id, aisle, sub]);

  // Setting the sub after the first load would re-run the effect; hold it in
  // a ref-backed setter that does not change the dependency until a person taps.
  const settledRef = useRef<string | null>(null);
  const settleSub = (k: string) => { settledRef.current = k; setSubsActive(k); };
  const [subActive, setSubsActive] = useState<string | null>(null);
  const activeSub = sub ?? subActive;

  // Pictures arrive after the grid: the browse response carries only cached
  // ones, and the rest are fetched here and patched in as they resolve.
  const hydrateImages = async (items: SearchHit[]) => {
    const missing = items.filter((h) => !h.imageUrl && h.gtin).map((h) => h.gtin!);
    if (missing.length === 0) return;
    const r = await api.images(household.id, missing).catch(() => null);
    if (!r) return;
    setProducts((xs) => (xs ?? []).map((h) => (h.gtin && r.images[h.gtin] ? { ...h, imageUrl: r.images[h.gtin]! } : h)));
  };

  const more = async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    try { const r = await api.browse(household.id, aisle, sub ?? undefined, page + 1); setProducts((xs) => [...(xs ?? []), ...r.products]); setPage(page + 1); setHasMore(r.hasMore); void hydrateImages(r.products); } finally { setLoadingMore(false); }
  };
  const inList = useMemo(() => new Set(lines.map((l) => l.gtin).filter(Boolean)), [lines]);
  const add = (h: SearchHit) => { tap(); addLine({ query: h.name, productName: h.name, ...(h.gtin ? { gtin: h.gtin } : {}), ...(h.brand ? { brand: h.brand } : {}), imageUrl: h.imageUrl }); setToast(tr('added')); setTimeout(() => setToast(null), 1200); };

  return (
    <View style={s.screen}>
      <Header title={`${meta?.glyph ?? ''} ${meta?.[locale === 'he' ? 'he' : 'en'] ?? aisle}`} subtitle={total ? tr('nProducts', { n: total }) : undefined} onBack={onBack} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 8, flexDirection: rtl ? 'row-reverse' : 'row' }} style={{ flexGrow: 0, marginBottom: 10 }}>
        {subs.map((k) => (
          <Pressable key={k} onPress={() => { if (k !== activeSub) { tap(); setSub(k); } }} style={{ backgroundColor: k === activeSub ? t.accent : t.card, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: k === activeSub ? t.accent : t.line }}>
            <Text style={{ color: k === activeSub ? '#fff' : t.ink, fontWeight: '600' }}>{subName(k, locale)}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}>
        {loading && products ? <View style={{ height: 3, backgroundColor: t.accentSoft, borderRadius: 2, marginBottom: 10, overflow: 'hidden' }}><View style={{ width: '40%', height: 3, backgroundColor: t.accent }} /></View> : null}
        {!products ? <><Skeleton /><Skeleton /><Skeleton /></> : (
          <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', flexWrap: 'wrap', gap: 10, opacity: loading ? 0.45 : 1 }}>
            {products.map((h) => {
              const have = !!h.gtin && inList.has(h.gtin);
              return (
                <Pressable key={h.productId} onPress={() => setOpen(h)} style={({ pressed }) => [s.card, { width: '47%', flexGrow: 1, marginBottom: 0, padding: 12 }, pressed && { opacity: 0.8 }]}>
                  <View style={{ alignItems: 'center', marginBottom: 8 }}><ProductImage url={h.imageUrl} gtin={h.gtin} name={h.name} size={96} radius={14} /></View>
                  <Text style={[s.body, { fontSize: 14, lineHeight: 19, minHeight: 38 }]} numberOfLines={2}>{h.name}</Text>
                  <View style={[s.rowStart, { marginTop: 4, flexWrap: 'wrap' }]}>{h.brand ? <Chip text={h.brand} tone="good" /> : null}{h.bought ? <Chip text={tr('boughtBefore')} tone="warn" /> : null}</View>
                  <View style={[s.row, { marginTop: 8, alignItems: 'flex-end' }]}>
                    <View>
                      {h.priceMin !== undefined && h.priceMax !== undefined && h.priceMax > h.priceMin
                        ? <Text style={s.price}>{money(h.priceMin)}<Text style={s.priceSmall}>–{money(h.priceMax)}</Text></Text>
                        : h.fromPrice !== undefined ? <Text style={s.price}>{money(h.fromPrice)}</Text> : null}
                      <Text style={s.faint}>{h.pricedAtChains > 1 ? `${tr('from')} · ${tr('atChains', { n: h.pricedAtChains })}` : tr('atChains', { n: 1 })}</Text>
                    </View>
                    <Pressable onPress={() => add(h)} disabled={have} hitSlop={8} style={{ backgroundColor: have ? t.accentSoft : t.accent, borderRadius: 999, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: have ? t.accent : '#fff', fontSize: 22, fontWeight: '800' }}>{have ? '✓' : '+'}</Text>
                    </Pressable>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
        {hasMore && !loading && products ? <View style={{ marginTop: 14 }}><Button title={loadingMore ? tr('loading') : tr('loadMore', { n: total - (products?.length ?? 0) })} kind="secondary" onPress={more} disabled={loadingMore} /></View> : null}
      </ScrollView>
      {open ? <ProductSheet api={api} household={household} hit={open} onAdd={() => { add(open); setOpen(null); }} onClose={() => setOpen(null)} inList={!!open.gtin && inList.has(open.gtin)} /> : null}
      <Toast text={toast} />
    </View>
  );
}

/** Every chain that carries the product, in one place. */
function ProductSheet({ api, household, hit, onAdd, onClose, inList }: { api: Api; household: Household; hit: SearchHit; onAdd: () => void; onClose: () => void; inList: boolean }) {
  const s = S();
  const [detail, setDetail] = useState<{ listings: { chainName: string; name: string }[]; prices?: { storefrontId: string; brand: string; price: number }[]; priceMin?: number; priceMax?: number } | null>(null);
  useEffect(() => { if (hit.gtin) api.product(household.id, hit.gtin).then(setDetail).catch(() => setDetail({ listings: [] })); else setDetail({ listings: [] }); }, [api, household.id, hit.gtin]);
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[s.screen, { paddingTop: 12 }]}>
        <Header title={hit.name} subtitle={hit.brand ?? ''} onBack={onClose} />
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 30 }}>
          <View style={{ alignItems: 'center', marginVertical: 10 }}><ProductImage url={hit.imageUrl} gtin={hit.gtin} name={hit.name} size={160} radius={22} /></View>
          <View style={[s.row, { marginBottom: 12 }]}>
            <Text style={s.small}>{hit.sizeQty ? `${hit.sizeQty}${hit.sizeUnit ?? ''}` : ''}{hit.unitPrice !== undefined ? ` · ${money(hit.unitPrice)}/${(hit.unitBasis ?? '').replace('per_', '')}` : ''}</Text>
            {hit.fromPrice !== undefined ? <Text style={s.priceBig}>{money(hit.fromPrice)}</Text> : null}
          </View>
          {!detail ? <Loading /> : (
            <>
              {detail.prices && detail.prices.length > 0 ? (
                <>
                  <View style={s.row}><Text style={s.title}>{tr('priceAt')}</Text>{detail.priceMin !== undefined && detail.priceMax !== undefined ? <Text style={s.priceSmall}>{money(detail.priceMin)}–{money(detail.priceMax)}</Text> : null}</View>
                  {detail.prices.map((p, i) => (
                    <View key={p.storefrontId} style={[s.row, { paddingVertical: 9, borderTopWidth: 1, borderColor: t.line }]}>
                      <View style={s.rowStart}><Text style={s.body}>{p.brand}</Text>{i === 0 ? <Chip text={tr('cheapestHere')} tone="good" /> : null}</View>
                      <Text style={[s.price, i === 0 && { color: t.accent }]}>{money(p.price)}</Text>
                    </View>
                  ))}
                </>
              ) : (
                <>
                  <Text style={[s.title, { marginBottom: 6 }]}>{tr('carriedBy')}</Text>
                  {detail.listings.map((l, i) => (
                    <View key={i} style={[s.row, { paddingVertical: 9, borderTopWidth: 1, borderColor: t.line }]}>
                      <Text style={s.body}>{l.chainName}</Text>
                      <Text style={[s.faint, { flexShrink: 1 }]} numberOfLines={1}>{l.name}</Text>
                    </View>
                  ))}
                </>
              )}
            </>
          )}
          <Text style={[s.faint, { marginTop: 10 }]}>{tr('pricesAtCompare')}</Text>
          <View style={{ height: 16 }} />
          <Button title={inList ? tr('inList') : tr('addToList')} onPress={onAdd} disabled={inList} />
        </ScrollView>
      </View>
    </Modal>
  );
}
