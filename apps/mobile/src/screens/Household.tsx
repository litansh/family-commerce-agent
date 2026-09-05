import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { REGIONS, type CountryCode } from '@fca/domain';
import type { Api, Household } from '../lib/api';
import { currentRegion, t as tr } from '../lib/i18n';
import { Button, Chip, Header, Input, S, t } from '../ui';

const FLAG = (c: string) => String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));

export function HouseholdSetup({ api, onDone }: { api: Api; onDone: (h: Household) => void }) {
  const s = S();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [country, setCountry] = useState<CountryCode>(currentRegion().country);
  const [retailers, setRetailers] = useState<string[]>(['shufersal']);
  const [fulfillment, setFulfillment] = useState<'delivery' | 'pickup' | 'either'>('delivery');
  const RETAILERS = ['shufersal', 'rami-levy', 'victory', 'carrefour', 'yochananof', 'tiv-taam'];
  const toggle = (r: string) => setRetailers((xs) => (xs.includes(r) ? xs.filter((x) => x !== r) : [...xs, r]));
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<Household>) => {
    setBusy(true); setErr(null);
    try { onDone(await fn()); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <ScrollView style={s.screen} keyboardShouldPersistTaps="handled">
      <Header title={tr('household')} subtitle={tr('householdSub')} />
      <View style={s.pad}>
        <View style={s.card}>
          <Text style={[s.title, { marginBottom: 12 }]}>{tr('newFamily')}</Text>
          <Input placeholder={tr('namePh')} value={name} onChangeText={setName} />
          <View style={{ height: 10 }} />
          <Input placeholder={tr('addressPh')} value={address} onChangeText={setAddress} />
          <Text style={[s.small, { marginTop: 14, marginBottom: 6 }]}>{tr('country')}</Text>
          <View style={[s.rowStart, { flexWrap: 'wrap' }]}>
            {(Object.keys(REGIONS) as CountryCode[]).map((c) => (
              <Pressable key={c} onPress={() => setCountry(c)} style={{ opacity: c === country ? 1 : 0.55 }}>
                <Chip text={`${FLAG(c)} ${c}${REGIONS[c].pricingAvailable ? '' : ' ·'}`} tone={c === country ? 'good' : 'neutral'} />
              </Pressable>
            ))}
          </View>
          {!REGIONS[country].pricingAvailable ? <Text style={[s.faint, { marginTop: 6 }]}>{tr('noPricing', { country })}</Text> : null}
          {country === 'IL' ? (
            <>
              <Text style={[s.small, { marginTop: 14 }]}>{tr('whereOrder')}</Text>
              <Text style={[s.faint, { marginBottom: 6 }]}>{tr('whereOrderHint')}</Text>
              <View style={[s.rowStart, { flexWrap: 'wrap' }]}>
                {RETAILERS.map((r) => <Pressable key={r} onPress={() => toggle(r)} style={{ opacity: retailers.includes(r) ? 1 : 0.5 }}><Chip text={r} tone={retailers.includes(r) ? 'good' : 'neutral'} /></Pressable>)}
              </View>
              <Text style={[s.small, { marginTop: 14, marginBottom: 6 }]}>{tr('howGet')}</Text>
              <View style={s.rowStart}>
                {(['delivery', 'pickup', 'either'] as const).map((f) => <Pressable key={f} onPress={() => setFulfillment(f)} style={{ opacity: fulfillment === f ? 1 : 0.5 }}><Chip text={tr(`${f}_`)} tone={fulfillment === f ? 'good' : 'neutral'} /></Pressable>)}
              </View>
            </>
          ) : null}
          <View style={{ height: 14 }} />
          <Button title={tr('create')} onPress={() => run(() => api.createHousehold(name, address, country, retailers, fulfillment))} disabled={busy || !name || !address} />
        </View>
        <View style={s.card}>
          <Text style={[s.title, { marginBottom: 4 }]}>{tr('haveFamily')}</Text>
          <Text style={[s.small, { marginBottom: 12 }]}>{tr('askCode')}</Text>
          <Input placeholder={tr('codePh')} value={code} onChangeText={setCode} autoCapitalize="characters" />
          <View style={{ height: 14 }} />
          <Button title={tr('join')} kind="secondary" onPress={() => run(() => api.acceptInvite(code))} disabled={busy || !code} />
        </View>
        {err ? <Text style={[s.small, { color: t.red }]}>{err}</Text> : null}
      </View>
    </ScrollView>
  );
}
