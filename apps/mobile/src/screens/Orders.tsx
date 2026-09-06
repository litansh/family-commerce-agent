import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { Api, Household, Order } from '../lib/api';
import { money, t as tr } from '../lib/i18n';
import { Chip, Empty, Header, S, Skeleton } from '../ui';

export function OrdersScreen({ api, household, onOpen }: { api: Api; household: Household; onOpen: (id: string) => void }) {
  const s = S();
  const [orders, setOrders] = useState<Order[] | null>(null);
  useEffect(() => { api.orders(household.id).then((r) => setOrders(r.orders)).catch(() => setOrders([])); }, [api, household.id]);
  const tone = (st: string): 'good' | 'warn' | 'bad' | 'neutral' => (st === 'placed' ? 'good' : st === 'awaiting_approval' ? 'warn' : st === 'failed' || st === 'cancelled' ? 'bad' : 'neutral');
  return (
    <View style={s.screen}>
      <Header title={tr('ordersTitle')} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}>
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
