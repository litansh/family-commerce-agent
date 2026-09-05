import React, { useState } from 'react';
import { Text, View } from 'react-native';
import type { Api, Household } from '../lib/api';
import { Button, Input, s } from '../ui';

export function HouseholdSetup({ api, onDone }: { api: Api; onDone: (h: Household) => void }) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async (fn: () => Promise<Household>) => {
    setBusy(true); setErr(null);
    try { onDone(await fn()); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  return (
    <View style={[s.screen, s.pad]}>
      <Text style={s.h1}>משק הבית</Text>
      <Text style={[s.muted, { marginBottom: 16 }]}>הזיכרון, הכתובת וההעדפות שייכים למשפחה, לא לאדם אחד.</Text>

      <View style={s.card}>
        <Text style={s.h2}>משפחה חדשה</Text>
        <Input placeholder="שם (למשל: משפחת שמיר)" value={name} onChangeText={setName} />
        <View style={{ height: 8 }} />
        <Input placeholder="כתובת למשלוח (רחוב, מספר, עיר)" value={address} onChangeText={setAddress} />
        <Button title="צור" onPress={() => run(() => api.createHousehold(name, address))} disabled={busy || !name || !address} />
      </View>

      <View style={s.card}>
        <Text style={s.h2}>הצטרפות עם קוד הזמנה</Text>
        <Input placeholder="קוד" value={code} onChangeText={setCode} autoCapitalize="characters" />
        <Button title="הצטרף" onPress={() => run(() => api.acceptInvite(code))} ghost disabled={busy || !code} />
      </View>
      {err ? <Text style={[s.muted, { color: '#b23a3a' }]}>{err}</Text> : null}
    </View>
  );
}
