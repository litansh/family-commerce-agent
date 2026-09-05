import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { signIn, type Tokens } from '../lib/auth';
import { Button, s, t } from '../ui';
import { Tile } from '../Logo';

export function SignIn({ onSignedIn }: { onSignedIn: (t: Tokens) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async (provider?: 'Google') => {
    setBusy(true); setErr(null);
    try { const tk = await signIn(provider); if (tk) onSignedIn(tk); else setErr('ההתחברות בוטלה'); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <View style={[s.screen, { justifyContent: 'flex-end', padding: 24, paddingBottom: 40 }]}>
      <View style={{ alignSelf: 'flex-end', marginBottom: 18 }}><Tile size={72} /></View>
      <Text style={[s.display, { fontSize: 44, marginBottom: 2 }]}>קנילי</Text>
      <Text style={[s.small, { fontSize: 15, marginBottom: 10 }]}>Kanili</Text>
      <Text style={[s.body, { color: t.muted, marginBottom: 28 }]}>רשימה אחת לכולם. השוואה בין כל הרשתות שמגיעות אליכם. וזיכרון של מה שאתם באמת קונים — כדי שלא תשכחו כלום.</Text>
      <Button title="המשך עם Google" onPress={() => go('Google')} disabled={busy} />
      <View style={{ height: 10 }} />
      <Button title="המשך עם אימייל" kind="secondary" onPress={() => go()} disabled={busy} />
      {err ? <Text style={[s.small, { color: t.red, marginTop: 14 }]}>{err}</Text> : null}
    </View>
  );
}
