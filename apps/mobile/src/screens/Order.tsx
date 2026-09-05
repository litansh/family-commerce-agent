import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { Api, Household, Order } from '../lib/api';
import { money, t as tr } from '../lib/i18n';
import { Button, Chip, Header, Loading, S, t } from '../ui';

const STEPS = ['queued', 'connecting', 'filling_cart', 'choosing_slot', 'awaiting_approval', 'approved', 'placing', 'placed'];

/**
 * An order placed through Kanili, live.
 *
 * The worker at home reports each step; this screen polls and shows it. The
 * one moment that matters is `awaiting_approval`: the real total from the
 * retailer's review page, the slot, and the payment method the retailer has
 * on file — and one button. Nothing is charged until it is tapped.
 */
export function OrderScreen({ api, household, orderId, onBack }: { api: Api; household: Household; orderId: string; onBack: () => void }) {
  const s = S();
  const [order, setOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const o = await api.order(household.id, orderId);
        if (alive) setOrder(o);
        if (alive && !['placed', 'cancelled', 'failed'].includes(o.status)) setTimeout(tick, 3000);
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      }
    };
    void tick();
    return () => { alive = false; };
  }, [api, household.id, orderId]);

  const act = async (fn: () => Promise<Order>) => {
    setBusy(true); setErr(null);
    try { setOrder(await fn()); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  if (!order) return <View style={s.screen}><Header title={tr('orderTitle')} onBack={onBack} /><Loading label={tr('orderConnecting')} /></View>;

  const idx = STEPS.indexOf(order.status);
  const awaiting = order.status === 'awaiting_approval';
  const terminal = ['placed', 'cancelled', 'failed'].includes(order.status);

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingBottom: 32 }}>
      <Header title={tr('orderTitle')} subtitle={`${order.retailer} · ${tr(`status_${order.status}`)}`} onBack={onBack} />
      <View style={{ paddingHorizontal: 20 }}>
        <View style={[s.card, { paddingVertical: 10 }]}>
          {STEPS.filter((st) => !['approved'].includes(st)).map((st, i) => {
            const done = idx > STEPS.indexOf(st) || order.status === 'placed';
            const now = order.status === st;
            return (
              <View key={st} style={[s.rowStart, { paddingVertical: 7, opacity: done || now ? 1 : 0.4 }]}>
                <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: done ? t.accent : now ? t.amberSoft : '#F1EEE6', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: done ? '#fff' : t.amber, fontSize: 12, fontWeight: '800' }}>{done ? '✓' : now ? '…' : String(i + 1)}</Text>
                </View>
                <Text style={[s.body, now && { fontWeight: '700' }]}>{tr(`status_${st}`)}</Text>
              </View>
            );
          })}
        </View>

        {awaiting && (
          <View style={[s.card, { borderWidth: 2, borderColor: t.accent }]}>
            <Text style={s.title}>{tr('approveTitle')}</Text>
            <Text style={[s.small, { marginBottom: 10 }]}>{tr('approveSub')}</Text>
            <View style={[s.row, { marginBottom: 6 }]}><Text style={s.small}>{tr('realTotal')}</Text><Text style={s.priceBig}>{money(order.total ?? 0)}</Text></View>
            {order.slot ? <View style={s.row}><Text style={s.small}>{tr('slot')}</Text><Text style={s.body}>{order.slot.label}</Text></View> : null}
            {order.paymentMethod ? <View style={s.row}><Text style={s.small}>{tr('payment')}</Text><Text style={s.body}>{order.paymentMethod}</Text></View> : null}
            <View style={{ height: 14 }} />
            <Button title={tr('approvePay', { x: money(order.total ?? 0) })} onPress={() => act(() => api.approveOrder(household.id, order.id))} disabled={busy} />
            <View style={{ height: 8 }} />
            <Button title={tr('cancel')} kind="quiet" onPress={() => act(() => api.cancelOrder(household.id, order.id))} disabled={busy} />
          </View>
        )}

        {order.status === 'placed' && (
          <View style={[s.card, { backgroundColor: t.accentSoft }]}>
            <Text style={[s.title, { color: t.accent }]}>{tr('placedTitle')}</Text>
            <Text style={s.body}>{tr('placedSub', { id: order.retailerOrderId ?? '' })}</Text>
          </View>
        )}
        {order.status === 'failed' && (
          <View style={[s.card, { backgroundColor: t.redSoft }]}>
            <Text style={[s.title, { color: t.red }]}>{tr('failedTitle')}</Text>
            <Text style={s.small}>{order.error ?? ''}</Text>
            <Text style={[s.small, { marginTop: 6 }]}>{tr('failedSub')}</Text>
          </View>
        )}
        {!terminal && !awaiting && <Text style={[s.small, { textAlign: 'center', marginTop: 6 }]}>{tr('workerNote')}</Text>}
        {order.lines.length > 0 && (
          <View style={[s.card, { marginTop: 8 }]}>
            {order.lines.map((l) => <View key={l.id} style={[s.row, { paddingVertical: 4 }]}><Text style={s.body}>{l.query}</Text><Chip text={l.gtin ? '✓' : '~'} tone={l.gtin ? 'good' : 'neutral'} /></View>)}
          </View>
        )}
        {err ? <Text style={[s.small, { color: t.red }]}>{err}</Text> : null}
      </View>
    </ScrollView>
  );
}
