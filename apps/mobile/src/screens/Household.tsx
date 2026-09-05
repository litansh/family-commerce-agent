import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { Api, Household } from '../lib/api';
import { Button, Header, Input, s, t } from '../ui';

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
    <ScrollView style={s.screen} keyboardShouldPersistTaps="handled">
      <Header title="משק הבית" subtitle="הרשימה, הכתובת והזיכרון שייכים למשפחה — לא לאדם אחד." />
      <View style={s.pad}>
        <View style={s.card}>
          <Text style={[s.title, { marginBottom: 12 }]}>משפחה חדשה</Text>
          <Input placeholder="שם — למשל: משפחת שמיר" value={name} onChangeText={setName} />
          <View style={{ height: 10 }} />
          <Input placeholder="כתובת למשלוח — רחוב, מספר, עיר" value={address} onChangeText={setAddress} />
          <View style={{ height: 14 }} />
          <Button title="צור משק בית" onPress={() => run(() => api.createHousehold(name, address))} disabled={busy || !name || !address} />
        </View>
        <View style={s.card}>
          <Text style={[s.title, { marginBottom: 4 }]}>יש לכם כבר משפחה?</Text>
          <Text style={[s.small, { marginBottom: 12 }]}>בקשו קוד הזמנה ממי שיצר אותה.</Text>
          <Input placeholder="קוד הזמנה" value={code} onChangeText={setCode} autoCapitalize="characters" />
          <View style={{ height: 14 }} />
          <Button title="הצטרף" kind="secondary" onPress={() => run(() => api.acceptInvite(code))} disabled={busy || !code} />
        </View>
        {err ? <Text style={[s.small, { color: t.red }]}>{err}</Text> : null}
      </View>
    </ScrollView>
  );
}
