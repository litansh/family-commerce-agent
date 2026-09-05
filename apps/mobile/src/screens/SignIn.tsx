import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { signIn, type Tokens } from '../lib/auth';
import { Button, s } from '../ui';

export function SignIn({ onSignedIn }: { onSignedIn: (t: Tokens) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async (provider?: 'Google') => {
    setBusy(true); setErr(null);
    try {
      const t = await signIn(provider);
      if (t) onSignedIn(t); else setErr('ההתחברות בוטלה');
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <View style={[s.screen, s.pad, { justifyContent: 'center' }]}>
      <Text style={s.h1}>קניות משפחתיות</Text>
      <Text style={[s.p, { marginBottom: 24 }]}>רשימה אחת, השוואה בין כל הרשתות, וזיכרון של מה שאתם באמת קונים.</Text>
      <Button title="התחברות עם Google" onPress={() => go('Google')} disabled={busy} />
      <Button title="התחברות עם אימייל" onPress={() => go()} ghost disabled={busy} />
      {err ? <Text style={[s.muted, { color: '#b23a3a', marginTop: 12 }]}>{err}</Text> : null}
    </View>
  );
}
