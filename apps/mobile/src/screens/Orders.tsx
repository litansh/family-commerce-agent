import React, { useEffect, useState } from 'react';
import { resolvePending, usePending } from '../lib/pending';
import { STORES } from '../lib/stores';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { Api, Household, Order } from '../lib/api';
import { money, t as tr } from '../lib/i18n';
import { Chip, Empty, Header, S, Skeleton , t } from '../ui';

export function OrdersScreen({ api, household, onOpen }: { api: Api; household: Household; onOpen: (id: string) => void }) {
  const s = S();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const pending = usePending();
  const confirm = async (id: string, yes: boolean) => {
    const p = pending.find((x) => x.id === id); if (!p) return;
    resolvePending(id);
    if (!yes) return;
    const bought = p.lines.filter((l) => l.gtin).map((l) => ({ phrase: l.name, gtin: l.gtin!, productName: l.name, packQty: l.qty }));
    if (bought.length) await api.recordShop(household.id, bought).catch(() => null);
  };
  useEffect(() => { api.orders(household.id).then((r) => setOrders(r.orders)).catch(() => setOrders([])); }, [api, household.id]);
  const tone = (st: string): 'good' | 'warn' | 'bad' | 'neutral' => (st === 'placed' ? 'good' : st === 'awaiting_approval' ? 'warn' : st === 'failed' || st === 'cancelled' ? 'bad' : 'neutral');
  return (
    <View style={s.screen}>
      <Header title={tr('ordersTitle')} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}>
        {/* Carts Kaniti filled: did the family finish the purchase at the store? Only a yes teaches the memory. */}
        {pending.map((p) => (
          <View key={p.id} style={[s.card, { borderWidth: 2, borderColor: t.amber }]} testID={`pending-${p.storeId}`}>
            <Text style={s.title}>{tr('pendingAsk', { s: STORES[p.storeId]?.name ?? p.storeId })}</Text>
            <Text style={s.small}>{new Date(p.at).toLocaleDateString()} · {p.lines.length} {tr('items')} · {p.lines.slice(0, 3).map((l) => l.name).join(', ')}{p.lines.length > 3 ? '…' : ''}</Text>
            <View style={[s.rowStart, { marginTop: 10, gap: 8, flexWrap: 'wrap' }]}>
              <Pressable onPress={() => void confirm(p.id, true)} style={{ backgroundColor: t.ink, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 }}><Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{tr('pendingYes')}</Text></Pressable>
              <Pressable onPress={() => void confirm(p.id, false)} style={{ borderWidth: 1, borderColor: t.ink, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14 }}><Text style={{ color: t.ink, fontWeight: '700', fontSize: 13 }}>{tr('pendingNo')}</Text></Pressable>
            </View>
          </View>
        ))}
        {!orders ? <><Skeleton /><Skeleton /></> : orders.length === 0 ? <Empty title={tr('noOrders')} hint="" /> : orders.map((o) => (
          <Pressable key={o.id} onPress={() => onOpen(o.id)} style={({ pressed }) => [s.card, pressed && { opacity: 0.7 }]}>
            <View style={s.row}>
              <View>
                <Text style={s.title}>{(o.legs ?? [{ retailer: o.retailer }]).map((l) => l.retailer).join(' + ')}</Text>
                <Text style={s.small}>{new Date(o.createdAt).toLocaleDateString()} · {o.lines.length} {tr('items')}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                {o.total ? <Text style={s.price}>{money(o.total)}</Text> : null}
                <Chip text={tr(`status_${o.status}`)} tone={tone(o.status)} />
              </View>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
