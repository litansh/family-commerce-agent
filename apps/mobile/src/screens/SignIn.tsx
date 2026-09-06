import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { signIn, type Tokens } from '../lib/auth';
import { isRTL, t as tr } from '../lib/i18n';
import { Button, S, t } from '../ui';
import { config } from '../lib/config';
import { Tile } from '../Logo';

export function SignIn({ onSignedIn }: { onSignedIn: (t: Tokens) => void }) {
  const s = S();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async (provider?: 'Google') => {
    setBusy(true); setErr(null);
    try { const tk = await signIn(provider); if (tk) onSignedIn(tk); else setErr(tr('cancelled')); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <View style={[s.screen, { justifyContent: 'flex-end', padding: 24, paddingBottom: 40 }]}>
      <View style={{ alignSelf: isRTL() ? 'flex-end' : 'flex-start', marginBottom: 18 }}><Tile size={72} /></View>
      <Text style={[s.display, { fontSize: 44, marginBottom: 2 }]}>{tr('appName')}</Text>
      {isRTL() ? <Text style={[s.small, { fontSize: 15, marginBottom: 10 }]}>Kanili</Text> : null}
      <Text style={[s.title, { fontSize: 22, marginBottom: 6 }]}>{tr('taglineShort')}</Text>
      <Text style={[s.body, { color: t.muted, marginBottom: 28 }]}>{tr('taglineLong')}</Text>
      {config.googleEnabled ? (
        <>
          <Button title={tr('continueGoogle')} onPress={() => go('Google')} disabled={busy} />
          <View style={{ height: 10 }} />
          <Button title={tr('continueEmail')} kind="secondary" onPress={() => go()} disabled={busy} />
        </>
      ) : (
        <Button title={tr('continueEmail')} onPress={() => go()} disabled={busy} />
      )}
      {err ? <Text style={[s.small, { color: t.red, marginTop: 14 }]}>{err}</Text> : null}
    </View>
  );
}
