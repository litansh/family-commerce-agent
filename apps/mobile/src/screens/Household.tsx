import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { Api, Household } from '../lib/api';
import { currentRegion, setLanguage, t as tr } from '../lib/i18n';
import { Button, Chip, Header, Input, S, t } from '../ui';

interface Suggestion { street: string; number: string; city: string; label: string; verified: boolean; lat: number; lng: number }

/**
 * Household setup, Israel-first: a verified street address with the details
 * a courier needs, the chains the family uses, and how they like to get it.
 * Language is a choice; the country is Israel until there is a second one.
 */
export function HouseholdSetup({ api, onDone }: { api: Api; onDone: (h: Household) => void }) {
  const s = S();
  const [name, setName] = useState('');
  const [q, setQ] = useState('');
  const [sugs, setSugs] = useState<Suggestion[]>([]);
  const [picked, setPicked] = useState<Suggestion | null>(null);
  const [apt, setApt] = useState('');
  const [floor, setFloor] = useState('');
  const [entrance, setEntrance] = useState('');
  const [notes, setNotes] = useState('');
  const [retailers, setRetailers] = useState<string[]>(['shufersal']);
  const [fulfillment, setFulfillment] = useState<'delivery' | 'pickup' | 'either'>('delivery');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [, bump] = useState(0);
  const seq = useRef(0);
  const RETAILERS = ['shufersal', 'rami-levy', 'victory', 'carrefour', 'yochananof', 'tiv-taam'];
  const NAMES: Record<string, string> = { shufersal: 'שופרסל', 'rami-levy': 'רמי לוי', victory: 'ויקטורי', carrefour: 'קרפור', yochananof: 'יוחננוף', 'tiv-taam': 'טיב טעם' };
  const lang = currentRegion().locale;

  useEffect(() => {
    if (picked && q === picked.label) return;
    const text = q.trim();
    if (text.length < 3) { setSugs([]); return; }
    const mine = ++seq.current;
    const h = setTimeout(() => { api.suggestAddress(text).then((r) => { if (mine === seq.current) setSugs(r.suggestions); }).catch(() => setSugs([])); }, 350);
    return () => clearTimeout(h);
  }, [q, api, picked]);

  const pick = (sg: Suggestion) => { setPicked(sg); setQ(sg.label); setSugs([]); };
  const toggle = (r: string) => setRetailers((xs) => (xs.includes(r) ? xs.filter((x) => x !== r) : [...xs, r]));
  const run = async (fn: () => Promise<Household>) => {
    setBusy(true); setErr(null);
    try { onDone(await fn()); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const address = picked ? picked.label : q.trim();
  const canCreate = !!name.trim() && !!picked?.verified;

  return (
    <ScrollView style={s.screen} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
      <Header title={tr('household')} subtitle={tr('householdSub')} action={lang === 'he' ? 'English' : 'עברית'} onAction={() => { setLanguage(lang === 'he' ? 'en' : 'he'); bump((n) => n + 1); }} />
      <View style={s.pad}>
        <View style={s.card}>
          <Text style={[s.title, { marginBottom: 12 }]}>{tr('newFamily')}</Text>
          <Input placeholder={tr('namePh')} value={name} onChangeText={setName} />

          <Text style={[s.small, { marginTop: 14, marginBottom: 6 }]}>{tr('addressLabel')}</Text>
          <Input placeholder={tr('addressPh')} value={q} onChangeText={(v) => { setQ(v); if (picked && v !== picked.label) setPicked(null); }} />
          {sugs.length > 0 && (
            <View style={{ backgroundColor: t.card, borderRadius: 10, borderWidth: 1, borderColor: t.line, marginTop: 4, overflow: 'hidden' }}>
              {sugs.map((sg, i) => (
                <Pressable key={i} onPress={() => pick(sg)} style={({ pressed }) => [s.row, { paddingVertical: 10, paddingHorizontal: 12, borderTopWidth: i ? 1 : 0, borderColor: t.line }, pressed && { backgroundColor: t.bg }]}>
                  <Text style={s.body}>{sg.label}</Text>
                  <Chip text={sg.verified ? tr('verified') : tr('partial')} tone={sg.verified ? 'good' : 'warn'} />
                </Pressable>
              ))}
            </View>
          )}
          {picked ? (
            <>
              <Text style={[s.small, { color: picked.verified ? t.accent : t.amber, marginTop: 6 }]}>{picked.verified ? `✓ ${tr('addressVerified')}` : tr('addressPartial')}</Text>
              <View style={[s.rowStart, { marginTop: 10, gap: 8 }]}>
                <Input placeholder={tr('apt')} value={apt} onChangeText={setApt} keyboardType="number-pad" style={{ flex: 1 }} />
                <Input placeholder={tr('floor')} value={floor} onChangeText={setFloor} keyboardType="number-pad" style={{ flex: 1 }} />
                <Input placeholder={tr('entrance')} value={entrance} onChangeText={setEntrance} style={{ flex: 1 }} />
              </View>
              <Input placeholder={tr('notesPh')} value={notes} onChangeText={setNotes} style={{ marginTop: 8 }} />
            </>
          ) : null}

          <Text style={[s.small, { marginTop: 16 }]}>{tr('whereOrder')}</Text>
          <Text style={[s.faint, { marginBottom: 6 }]}>{tr('whereOrderHint')}</Text>
          <View style={[s.rowStart, { flexWrap: 'wrap' }]}>
            {RETAILERS.map((r) => <Pressable key={r} onPress={() => toggle(r)} style={{ opacity: retailers.includes(r) ? 1 : 0.5 }}><Chip text={lang === 'he' ? NAMES[r]! : r} tone={retailers.includes(r) ? 'good' : 'neutral'} /></Pressable>)}
          </View>
          <Text style={[s.small, { marginTop: 14, marginBottom: 6 }]}>{tr('howGet')}</Text>
          <View style={s.rowStart}>
            {(['delivery', 'pickup', 'either'] as const).map((f) => <Pressable key={f} onPress={() => setFulfillment(f)} style={{ opacity: fulfillment === f ? 1 : 0.5 }}><Chip text={tr(`${f}_`)} tone={fulfillment === f ? 'good' : 'neutral'} /></Pressable>)}
          </View>
          <View style={{ height: 16 }} />
          <Button title={tr('create')} disabled={busy || !canCreate}
            onPress={() => run(() => api.createHousehold({ name: name.trim(), address, country: 'IL', retailers, fulfillment, language: lang, addressDetails: { street: picked?.street, number: picked?.number, city: picked?.city, lat: picked?.lat, lng: picked?.lng, apt, floor, entrance, notes } }))} />
          {!picked?.verified && q.trim().length > 0 ? <Text style={[s.faint, { marginTop: 6 }]}>{tr('pickFromList')}</Text> : null}
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
