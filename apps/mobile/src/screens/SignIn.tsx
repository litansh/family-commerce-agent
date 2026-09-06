import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { saveTokens, signIn, type Tokens } from '../lib/auth';
import { confirmForgotPassword, confirmSignUp, explain, forgotPassword, passwordSignIn, resendCode, signUp } from '../lib/cognito';
import { config } from '../lib/config';
import { isRTL, t as tr, useLanguage } from '../lib/i18n';
import { Button, Input, LanguagePicker, S, t } from '../ui';
import { Tile } from '../Logo';

type Mode = 'signin' | 'signup' | 'confirm' | 'forgot' | 'reset';

/**
 * Sign-in and sign-up as real forms in the family's language. Cognito is
 * the identity store underneath; nothing here ever sees a password after
 * the request that carries it.
 */
export function SignIn({ onSignedIn }: { onSignedIn: (t: Tokens) => void }) {
  const s = S();
  const rtl = isRTL();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useLanguage();

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null); setNote(null);
    try { await fn(); } catch (e) { setErr(explain(e, (k) => tr(k))); } finally { setBusy(false); }
  };
  const finish = async (tk: Tokens) => { await saveTokens(tk); onSignedIn(tk); };

  const doSignUp = () => run(async () => {
    if (pw !== pw2) { setErr(tr('errMismatch')); return; }
    if (pw.length < 10) { setErr(tr('errWeak')); return; }
    await signUp(email.trim(), pw);
    setMode('confirm'); setNote(tr('codeSent', { e: email.trim() }));
  });
  const doConfirm = () => run(async () => {
    await confirmSignUp(email.trim(), code.trim());
    await finish(await passwordSignIn(email.trim(), pw));
  });
  const doSignIn = () => run(async () => {
    try { await finish(await passwordSignIn(email.trim(), pw)); }
    catch (e) { if ((e as { code?: string }).code === 'UserNotConfirmedException') { await resendCode(email.trim()); setMode('confirm'); setNote(tr('codeSent', { e: email.trim() })); } else throw e; }
  });
  const doForgot = () => run(async () => { await forgotPassword(email.trim()); setMode('reset'); setNote(tr('codeSent', { e: email.trim() })); });
  const doReset = () => run(async () => {
    if (pw !== pw2) { setErr(tr('errMismatch')); return; }
    await confirmForgotPassword(email.trim(), code.trim(), pw);
    await finish(await passwordSignIn(email.trim(), pw));
  });
  const google = () => run(async () => { const tk = await signIn('Google'); if (tk) onSignedIn(tk); else setErr(tr('cancelled')); });

  const title = { signin: tr('signInTitle'), signup: tr('signUpTitle'), confirm: tr('confirmTitle'), forgot: tr('forgotTitle'), reset: tr('resetTitle') }[mode];

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }} keyboardShouldPersistTaps="handled">
      <View style={[s.row, { marginBottom: 18 }]}>
        <Tile size={64} />
        <LanguagePicker />
      </View>
      <Text style={[s.display, { fontSize: 40 }]}>{tr('appName')}</Text>
      <Text style={[s.title, { fontSize: 20, marginTop: 2 }]}>{tr('taglineShort')}</Text>
      <Text style={[s.body, { color: t.muted, marginTop: 6, marginBottom: 24 }]}>{tr('taglineLong')}</Text>

      <Text style={[s.title, { marginBottom: 10 }]}>{title}</Text>
      {(mode === 'signin' || mode === 'signup' || mode === 'forgot') && (
        <Input placeholder={tr('email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
      )}
      {(mode === 'confirm' || mode === 'reset') && (
        <Input placeholder={tr('code')} value={code} onChangeText={setCode} keyboardType="number-pad" textContentType="oneTimeCode" style={{ marginTop: 0 }} />
      )}
      {(mode === 'signin' || mode === 'signup' || mode === 'reset') && (
        <Input placeholder={mode === 'reset' ? tr('newPassword') : tr('password')} value={pw} onChangeText={setPw} secureTextEntry autoCapitalize="none" textContentType={mode === 'signin' ? 'password' : 'newPassword'} style={{ marginTop: 10 }} />
      )}
      {(mode === 'signup' || mode === 'reset') && (
        <>
          <Input placeholder={tr('passwordAgain')} value={pw2} onChangeText={setPw2} secureTextEntry autoCapitalize="none" textContentType="newPassword" style={{ marginTop: 10 }} />
          <Text style={[s.faint, { marginTop: 6 }]}>{tr('pwRule')}</Text>
        </>
      )}
      {note ? <Text style={[s.small, { color: t.accent, marginTop: 10 }]}>{note}</Text> : null}
      {err ? <Text style={[s.small, { color: t.red, marginTop: 10 }]}>{err}</Text> : null}
      <View style={{ height: 16 }} />

      {mode === 'signin' && <Button title={tr('signInBtn')} onPress={doSignIn} disabled={busy || !email || !pw} />}
      {mode === 'signup' && <Button title={tr('signUpBtn')} onPress={doSignUp} disabled={busy || !email || !pw || !pw2} />}
      {mode === 'confirm' && <Button title={tr('confirmBtn')} onPress={doConfirm} disabled={busy || code.length < 4} />}
      {mode === 'forgot' && <Button title={tr('sendCode')} onPress={doForgot} disabled={busy || !email} />}
      {mode === 'reset' && <Button title={tr('resetBtn')} onPress={doReset} disabled={busy || !code || !pw || !pw2} />}

      <View style={{ height: 14 }} />
      <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', justifyContent: 'space-between' }}>
        {mode === 'signin' ? (
          <>
            <Pressable onPress={() => setMode('signup')} hitSlop={8}><Text style={s.link}>{tr('noAccount')}</Text></Pressable>
            <Pressable onPress={() => setMode('forgot')} hitSlop={8}><Text style={[s.link, { color: t.muted }]}>{tr('forgotLink')}</Text></Pressable>
          </>
        ) : mode === 'confirm' ? (
          <>
            <Pressable onPress={() => run(async () => { await resendCode(email.trim()); setNote(tr('codeSent', { e: email.trim() })); })} hitSlop={8}><Text style={s.link}>{tr('resend')}</Text></Pressable>
            <Pressable onPress={() => setMode('signin')} hitSlop={8}><Text style={[s.link, { color: t.muted }]}>{tr('backToSignIn')}</Text></Pressable>
          </>
        ) : (
          <Pressable onPress={() => setMode('signin')} hitSlop={8}><Text style={s.link}>{tr('backToSignIn')}</Text></Pressable>
        )}
      </View>

      {config.googleEnabled && mode === 'signin' ? (
        <>
          <Text style={[s.faint, { textAlign: 'center', marginVertical: 14 }]}>{tr('orDivider')}</Text>
          <Button title={tr('continueGoogle')} kind="secondary" onPress={google} disabled={busy} />
        </>
      ) : null}
    </ScrollView>
  );
}
