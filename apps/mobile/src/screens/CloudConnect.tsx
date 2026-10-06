import React, { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { Api } from '../lib/api';
import type { SignupField, StoreDef } from '../lib/stores';
import { isRTL, t as tr } from '../lib/i18n';
import { Button, Input, S, t } from '../ui';

/**
 * The cloud rung of "connect a store" (ADR 0008), used where there is no
 * WebView - the web app - and as the fallback on the phone.
 *
 * Two honest screens, decided by the store:
 *   password  e-mail + password typed once, forwarded to the store over TLS,
 *             used for one sign-in, discarded. Kaniti keeps the session the
 *             store issued, sealed, and nothing the person typed.
 *   phone     the store gates its sign-in behind a captcha or blocks
 *             datacenters, so the only honest thing to say is "from your
 *             phone" - and then the connection appears here by itself.
 *
 * Both offer the sign-up guide: what the store's form asks for, with every
 * value Kaniti already knows ready to copy, and a button to the store's page.
 */
export function CloudConnect({ store, api, householdId, email, onLinked, onClose }: { store: StoreDef; api: Api; householdId: string; email: string | null; onLinked: () => void; onClose: () => void }) {
  const s = S();
  const rtl = isRTL();
  const [user, setUser] = useState(email ?? '');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [imported, setImported] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [signup, setSignup] = useState(false);
  useEffect(() => { if (email && !user) setUser(email); }, [email]); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = async () => {
    setBusy(true); setErr(null);
    try {
      await api.connectStore(householdId, store.id, { method: 'password', email: user.trim(), password: pw });
      setPw(''); // used once; gone from memory as soon as the store answered
      setDone(true);
      setImporting(true);
      api.cloudImport(householdId, store.id).then((r) => setImported(r.orders)).catch(() => setImported(0)).finally(() => setImporting(false));
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setErr(/wrong_password|not_signed_in|401/.test(m) ? tr('cloudWrongPw', { s: store.name }) : tr('cloudUnavailable', { s: store.name }));
    } finally { setBusy(false); }
  };

  if (signup) return <SignupGuide store={store} api={api} householdId={householdId} email={email} onOpen={() => { void openUrl(store.signup.url); }} onBack={() => setSignup(false)} />;

  if (done) {
    return (
      <View style={[s.pad, { flex: 1, justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ fontSize: 48 }}>✓</Text>
        <Text style={[s.title, { marginTop: 12, textAlign: 'center' }]}>{tr('cloudConnected', { s: store.name })}</Text>
        <Text style={[s.body, { color: t.muted, textAlign: 'center', marginTop: 6 }]}>{tr('cloudConnectedSub', { s: store.name })}</Text>
        {importing ? <Text style={[s.small, { marginTop: 10 }]}>{tr('cloudImporting', { s: store.name })}</Text>
          : imported != null && imported > 0 ? <Text style={[s.small, { color: t.accent, marginTop: 10 }]}>{tr('cloudImported', { n: imported })}</Text>
          : imported === 0 ? <Text style={[s.faint, { marginTop: 10 }]}>{tr('cloudImportedNone', { s: store.name })}</Text> : null}
        <View style={{ height: 16 }} />
        <Button title={tr('done')} onPress={onLinked} />
      </View>
    );
  }

  if (store.cloud !== 'password') {
    // Phone-only store: say exactly that, once, without a dead end.
    return (
      <ScrollView contentContainerStyle={[s.pad, { paddingTop: 24 }]}>
        <Text style={[s.title, { textAlign: rtl ? 'right' : 'left' }]}>{tr('cloudPhoneTitle', { s: store.name })}</Text>
        <Text style={[s.body, { color: t.muted, marginTop: 8, textAlign: rtl ? 'right' : 'left' }]}>{tr('cloudPhoneSub', { s: store.name })}</Text>
        <View style={[s.card, { marginTop: 16, backgroundColor: t.accentSoft }]}><Text style={[s.small, { color: t.accent, fontWeight: '700', textAlign: rtl ? 'right' : 'left' }]}>{tr('cloudPhoneHint', { s: store.name })}</Text></View>
        <View style={{ height: 12 }} />
        <Button title={tr('cloudNoAccount', { s: store.name })} kind="secondary" onPress={() => setSignup(true)} />
        <Button title={tr('ok')} kind="quiet" onPress={onClose} />
      </ScrollView>
    );
  }

  const userPh = store.id === 'hazi-hinam' ? tr('cloudUserPh', { s: store.name }) : tr('cloudEmailPh', { s: store.name });
  return (
    <ScrollView contentContainerStyle={[s.pad, { paddingTop: 24 }]} keyboardShouldPersistTaps="handled">
      <Text style={[s.title, { textAlign: rtl ? 'right' : 'left' }]}>{tr('cloudPwTitle', { s: store.name })}</Text>
      <Text style={[s.small, { color: t.muted, marginTop: 6, textAlign: rtl ? 'right' : 'left' }]}>{tr('cloudPwSub', { s: store.name })}</Text>
      <View style={{ height: 14 }} />
      <Input value={user} onChangeText={setUser} placeholder={userPh} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="username" autoComplete="username" testID="cloud-user" />
      <View style={{ height: 8 }} />
      <Input value={pw} onChangeText={setPw} placeholder={tr('cloudPwPh', { s: store.name })} secureTextEntry textContentType="password" autoComplete="current-password" onSubmitEditing={() => { if (user && pw && !busy) void connect(); }} testID="cloud-password" />
      {err ? <Text style={[s.small, { color: t.red, marginTop: 8, textAlign: rtl ? 'right' : 'left' }]}>{err}</Text> : null}
      <View style={{ height: 12 }} />
      <Button title={busy ? tr('cloudConnecting', { s: store.name }) : tr('cloudConnectBtn')} onPress={() => void connect()} disabled={busy || !user.trim() || !pw} testID="cloud-connect" />
      <View style={[s.rowStart, { marginTop: 14, gap: 16, flexWrap: 'wrap', justifyContent: 'center' }]}>
        <Pressable onPress={() => { void openUrl(store.loginUrl); }} hitSlop={8}><Text style={s.link}>{tr('forgotPwLink', { s: store.name })}</Text></Pressable>
        <Pressable onPress={() => setSignup(true)} hitSlop={8}><Text style={s.link}>{tr('cloudNoAccount', { s: store.name })}</Text></Pressable>
      </View>
      <Text style={[s.faint, { textAlign: 'center', marginTop: 18 }]}>{tr('linkPrivacy')}</Text>
    </ScrollView>
  );
}

/**
 * "No account at this store?" - the guide. Kaniti cannot fill a form on
 * another origin from the web, so it does the next best thing: shows exactly
 * what the store will ask, with every value it already knows one tap from the
 * clipboard, and opens the store's own sign-up. On the phone the caller
 * navigates the WebView there instead and the prefill script does the typing.
 */
export function SignupGuide({ store, api, householdId, email, onOpen, onBack }: { store: StoreDef; api: Api; householdId: string; email: string | null; onOpen: () => void; onBack: () => void }) {
  const s = S();
  const rtl = isRTL();
  const [address, setAddress] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => { api.household(householdId).then((h) => setAddress(h.address)).catch(() => null); }, [api, householdId]);
  // What Kaniti knows. Never an ID number, a birth date or a password - those are the person's alone.
  const known: Partial<Record<SignupField, string | null>> = { email, address };
  const copy = async (k: string, v: string) => { if (Platform.OS === 'web') await navigator.clipboard?.writeText(v); else await Clipboard.setStringAsync(v); setCopied(k); setTimeout(() => setCopied(null), 1400); };
  return (
    <ScrollView contentContainerStyle={[s.pad, { paddingTop: 20 }]}>
      <Text style={[s.title, { textAlign: rtl ? 'right' : 'left' }]}>{tr('signupTitle', { s: store.name })}</Text>
      <Text style={[s.small, { color: t.muted, marginTop: 6, textAlign: rtl ? 'right' : 'left' }]}>{tr('signupSub', { s: store.name })}</Text>
      <View style={[s.card, { marginTop: 14, paddingVertical: 4 }]}>
        {store.signup.asks.map((f, i) => {
          const v = known[f] ?? null;
          return (
            <View key={f} style={[s.row, { paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderColor: t.line }]}>
              <View style={{ flexShrink: 1 }}>
                <Text style={s.body}>{tr(`field_${f}`)}</Text>
                {v ? <Text style={[s.small, { color: t.muted }]} numberOfLines={1}>{v}</Text> : <Text style={s.faint}>{tr('notKnown')}</Text>}
              </View>
              {v ? <Pressable onPress={() => void copy(f, v)} hitSlop={8} style={{ backgroundColor: t.accentSoft, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 }}><Text style={{ color: t.accent, fontWeight: '700', fontSize: 13 }}>{copied === f ? tr('copiedShort') : tr('copy')}</Text></Pressable> : null}
            </View>
          );
        })}
      </View>
      <View style={{ height: 12 }} />
      <Button title={tr('signupOpen', { s: store.name })} icon="link" onPress={onOpen} testID="signup-open" />
      <Text style={[s.small, { color: t.muted, textAlign: 'center', marginTop: 10 }]}>{tr('signupThen')}</Text>
      <Button title={tr('back')} kind="quiet" onPress={onBack} />
    </ScrollView>
  );
}

async function openUrl(url: string): Promise<void> {
  if (Platform.OS === 'web') { window.open(url, '_blank', 'noopener'); return; }
  await Linking.openURL(url).catch(() => null);
}
