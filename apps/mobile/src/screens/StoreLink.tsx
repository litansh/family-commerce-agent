import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { confirmFromHistory } from '../lib/pending';
import React, { useEffect, useRef, useState } from 'react';
import { Linking, Modal, Platform, Text, View } from 'react-native';
import { STORES, signupFillJs, type SignupKnown } from '../lib/stores';
import { markLinked, markUnlinked } from '../lib/linked';
import { t as tr } from '../lib/i18n';
import { Button, S, t } from '../ui';
import { Pressable } from 'react-native';
import { isRTL } from '../lib/i18n';
import { BUILD } from '../lib/config';
import { CloudConnect, SignupGuide } from './CloudConnect';
import { captureSessionJs, hasAuthSession, parseCapturedSession, sessionSummary, signedInPollJs } from '../lib/session';
import { CONSENT_JS, guardedJs, HISTORY_JS, OTP_JS, PROBE_JS } from '../lib/inject';

/**
 * Connect a store, entirely inside Kaniti.
 *
 * The store's own login opens in a WebView, so the OS autofills a saved
 * password with Face ID, or the person enters the SMS code — the very page
 * the store's own app uses, which is why "already have an account" and "new"
 * are one flow. Every couple of seconds Kaniti asks the store's own page
 * whether it is signed in; when it says yes, the store is connected.
 *
 * On the web there is no WebView (stores forbid being framed), so the web
 * takes the cloud rung instead (`CloudConnect`, ADR 0008): a password typed
 * once where the store allows it, and an honest "from your phone" where the
 * store gates sign-in behind a captcha.
 *
 * After a native sign-in the session is captured (the cookies the page can
 * read, plus the store's token names) and sent to the cloud, so the family's
 * other devices - and the web - see the store as connected too. The WebView
 * stays mounted (hidden) behind the "connected" panel until then: an
 * unmounted WebView never delivers the messages its last scripts post, which
 * is how a session capture can run and still reach nobody.
 */
export function StoreLink({ storeId, api, householdId, onClose, onLinked }: { storeId: string; api: import('../lib/api').Api; householdId: string; onClose: () => void; onLinked: (id: string) => void }) {
  const s = S();
  const store = STORES[storeId];
  const [signedIn, setSignedIn] = useState(false);
  const signedInRef = useRef(false);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<number | null>(null);
  const didImport = useRef(false);
  const notIn = useRef(0);
  const seenIn = useRef(0);
  // Everything a phone can tell the server about a store it cannot see: one JSON line in the log.
  const report = (diag: Record<string, unknown>) => api.importHistory(householdId, storeId, [], { build: BUILD, ...diag }).catch(() => null);
  // A store page that fails to load (a cancelled redirect, a hiccup) retries once by
  // itself and is reported; the person sees a plain "try again", never a raw error page.
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const retried = useRef(false);
  const onLoadError = (e: { nativeEvent: { code?: number; description?: string; url?: string; domain?: string } }) => {
    const ev = e.nativeEvent;
    void report({ loadError: { code: ev.code, description: ev.description, url: ev.url, domain: ev.domain } });
    if (ev.code === -999 && !retried.current) { retried.current = true; setTimeout(() => (webref.current as unknown as { reload?: () => void } | null)?.reload?.(), 800); return; } // cancelled: the store redirected mid-load
    if (!retried.current) { retried.current = true; setTimeout(() => (webref.current as unknown as { reload?: () => void } | null)?.reload?.(), 1200); return; }
    setLoadErr(ev.description ?? 'load error');
  };
  const webref = useRef<import('react-native-webview').WebView | null>(null);

  // Cloudflare in front of a store (Victory) may put a "verify you are human" step, or a
  // flat block page, where the login should be. The challenge is the person's to click:
  // nothing is injected or clicked while it is on screen (`guardedJs`), and the app says
  // what it is. A block page gets an "open in Safari" way out.
  const [guard, setGuard] = useState<'' | 'challenge' | 'blocked'>('');

  // Native module: require lazily so the web build still loads.
  const WebView = Platform.OS === 'web' ? null : (() => { try { return require('react-native-webview').WebView as typeof import('react-native-webview').WebView; } catch { return null; } })();

  const raw = (js?: string) => { if (js) (webref.current as unknown as { injectJavaScript?: (s: string) => void } | null)?.injectJavaScript?.(js); };
  const inject = (js?: string) => { if (js) raw(guardedJs(js)); };

  // Poll the store's own signed-in check through the WebView, until it says yes.
  const ticks = useRef(0);
  useEffect(() => {
    if (!WebView) return;
    const id = setInterval(() => {
      if (signedInRef.current) return;
      ticks.current += 1;
      raw(signedInPollJs(store!));
      // Once, after a few seconds: report what the check actually sees, so a
      // silent "connected but nothing happens" is debuggable from the server log.
      if (ticks.current === 4 || ticks.current === 24) raw(PROBE_JS);
    }, 2500);
    return () => clearInterval(id);
  }, [WebView, store, storeId]);

  const [diag, setDiag] = useState<string | null>(null);
  // The person's own e-mail, filled into the store's form on their own device
  // so the only thing left to type is the code (or, once, a password).
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => { api.me().then((m) => setEmail(m.email ?? null)).catch(() => null); }, [api]);
  // What Kaniti knows for a store's sign-up form: e-mail, the family name, the delivery address.
  const [known, setKnown] = useState<SignupKnown>({});
  useEffect(() => {
    api.household(householdId).then((h) => {
      const ad = (h as unknown as { addressDetails?: Record<string, unknown> }).addressDetails ?? {};
      const str = (k: string) => (typeof ad[k] === 'string' && ad[k] ? String(ad[k]) : typeof ad[k] === 'number' ? String(ad[k]) : undefined);
      const fam = /^משפחת\s+(.+)$/.exec(h.name)?.[1];
      setKnown({ ...(fam ? { lastName: fam } : {}), ...(str('street') ? { street: str('street') } : {}), ...(str('number') ? { number: str('number') } : {}), ...(str('city') ? { city: str('city') } : {}), ...(str('apt') ? { apt: str('apt') } : {}), ...(str('floor') ? { floor: str('floor') } : {}), ...(str('entrance') ? { entrance: str('entrance') } : {}) });
    }).catch(() => null);
  }, [api, householdId]);
  const settle = () => {
    if (signedInRef.current) return;
    inject(OTP_JS);
    setTimeout(() => inject(CONSENT_JS), 900); setTimeout(() => inject(CONSENT_JS), 3500);
    // After a load: open the login dialog and fill the e-mail; SPAs need a second pass.
    inject(store?.openLoginJs);
    setTimeout(() => { inject(store?.openLoginJs); if (email) inject(store?.prefillEmailJs?.(email)); }, 1200);
    setTimeout(() => { if (email) inject(store?.prefillEmailJs?.(email)); }, 3000);
    // A sign-up form on screen gets everything Kaniti knows; SPAs render late, so twice.
    setTimeout(() => inject(signupFillJs({ ...known, ...(email ? { email } : {}) })), 2000);
    setTimeout(() => inject(signupFillJs({ ...known, ...(email ? { email } : {}) })), 5000);
  };
  const createPassword = () => { inject(store?.forgotJs); setTimeout(() => { if (email) inject(store?.prefillEmailJs?.(email)); }, 900); };
  const [signup, setSignup] = useState(false);
  const [saved, setSaved] = useState<boolean | null>(null);
  // Device rung → cloud: everything the page itself can read (cookies without
  // HttpOnly, localStorage tokens) goes up; the API keeps it sealed. This is
  // the family's "connected" marker - ordering itself runs here, on the phone,
  // where the full session lives (ADR 0008 amendment). The capture runs
  // unguarded: the store just said "signed in", so no challenge is on screen.
  const captureTries = useRef(0);
  const capture = () => { captureTries.current += 1; raw(captureSessionJs(store!)); };
  const postSession = async (json: string): Promise<void> => {
    const got = parseCapturedSession(json);
    const sum = sessionSummary(got);
    // A single-page store can write its token a beat after it says "signed in": one more look.
    // Decorative cookies (analytics, ad ids) are on every page, signed in or not - "not empty"
    // is not "has the store's own session", so the retry is keyed on the named session keys.
    const authOk = hasAuthSession(got, store?.sessionKeys);
    if (!authOk && captureTries.current < 2) { void report({ sessionCapture: { ...sum, empty: sum.cookies + sum.tokens === 0, authKeyMissing: true, retry: true } }); setTimeout(capture, 2500); return; }
    try {
      const r = await api.postStoreSession(householdId, storeId, { cookies: got.cookies, tokens: got.tokens, ...(got.userAgent ? { userAgent: got.userAgent } : {}) });
      setSaved(r.connected);
      void report({ sessionCapture: { ...sum, authKeyMissing: !authOk, saved: r.connected } });
    } catch (e) {
      // The cloud copy failed (network, a 4xx): the store is still connected on this phone,
      // the panel says so, and the log says why the family's other devices will not see it.
      setSaved(false);
      void report({ sessionCapture: { ...sum, authKeyMissing: !authOk, saved: false, postError: String(e).slice(0, 200) } });
    }
  };
  // The store's own page said yes (twice in a row), or the person did: connected. Capture the
  // session and read the order history through it, in the same WebView, which stays mounted.
  const onSignedIn = (how: 'store' | 'person') => {
    signedInRef.current = true; setSignedIn(true);
    // The store itself says the person is in: any "needs re-connecting" suspicion is wrong, clear it now.
    markLinked(storeId);
    if (didImport.current) return;
    didImport.current = true;
    void report({ signedIn: how });
    raw(PROBE_JS); capture();
    const h = store?.historyJs ?? (storeId === 'shufersal' ? HISTORY_JS : undefined);
    if (h) { setImporting(true); raw(h); }
  };
  const postHistory = async (json: string): Promise<void> => {
    try {
      const parsed = JSON.parse(json) as unknown;
      const env = Array.isArray(parsed) ? { orders: parsed, diag: undefined } : (parsed as { orders?: unknown[]; diag?: Record<string, unknown> });
      const orders = Array.isArray(env.orders) ? env.orders : [];
      if (env.diag) setDiag(JSON.stringify(env.diag));
      // A cart Kaniti filled that the store now lists as an order is a confirmed purchase.
      confirmFromHistory(storeId, orders as { at?: string; lines: { name: string; code?: string }[] }[]);
      // Always post, even with nothing: the diagnostic reaches the server log
      // so a wrong shape can be fixed without a phone in hand.
      const r = await api.importHistory(householdId, storeId, orders as never, { build: BUILD, ...(env.diag ?? {}) });
      setImported(r.orders);
    } catch (e) { setImported(0); setDiag(String(e)); } finally { setImporting(false); }
  };

  if (!store) return null;
  // The web's copy lives in CloudConnect; the header keeps only the store name there.
  const hint = !WebView ? '' : store.loginKind === 'otp' ? tr('linkHintOtp', { s: store.name }) : tr('linkHintPw', { s: store.name });
  // Behind the "connected" panel and the sign-up guide the WebView lives on, out of sight,
  // so the scripts it is still running (capture, history, the sign-up page) reach us.
  const HIDDEN = { width: 1, height: 1, opacity: 0, position: 'absolute' as const, left: -2, top: -2 };

  const rtl = isRTL();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      {/* A full-screen modal starts under the clock; the app provider's top inset keeps the close bar below it. */}
      <View style={[s.screen, { paddingTop: Math.max(insets.top, 20) + 4 }]}>
        {/* Solid close bar, always on top of the WebView. */}
        <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: t.line, backgroundColor: t.card, zIndex: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={[s.title, { fontSize: 18, textAlign: rtl ? 'right' : 'left' }]}>{tr('connectStore', { s: store.name })}</Text>
            {hint ? <Text style={[s.small, { textAlign: rtl ? 'right' : 'left' }]}>{hint}</Text> : null}
          </View>
          <Pressable onPress={onClose} hitSlop={16} testID="link-close" style={{ backgroundColor: t.bg, borderRadius: 999, width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginRight: rtl ? 0 : 4, marginLeft: rtl ? 4 : 0 }}>
            <Text style={{ fontSize: 20, color: t.ink, fontWeight: '700' }}>✕</Text>
          </Pressable>
        </View>
        {!WebView ? (
          <CloudConnect store={store} api={api} householdId={householdId} email={email} onLinked={() => onLinked(store.id)} onClose={onClose} />
        ) : (
          <>
            {signup ? (
              <SignupGuide store={store} api={api} householdId={householdId} email={email} onOpen={() => { setSignup(false); raw(`location.href=${JSON.stringify(store.signup.url)};true;`); }} onBack={() => setSignup(false)} />
            ) : signedIn ? (
              <View style={[s.pad, { flex: 1, justifyContent: 'center', alignItems: 'center' }]} testID="link-connected">
                <Text style={{ fontSize: 48 }}>✓</Text>
                <Text style={[s.title, { marginTop: 12, textAlign: 'center' }]}>{tr('linked', {})}</Text>
                <Text style={[s.body, { color: t.muted, textAlign: 'center', marginTop: 6 }]}>{tr('linkedSub', { s: store.name })}</Text>
                {saved != null ? <Text style={[s.small, { marginTop: 8, color: saved ? t.accent : t.muted }]}>{saved ? tr('sessionSaved') : tr('sessionNotSaved')}</Text> : null}
                {importing ? <Text style={[s.small, { marginTop: 10 }]}>{tr('importingHistory')}</Text>
                  : imported != null && imported > 0 ? <Text style={[s.small, { color: t.accent, marginTop: 10 }]}>{tr('importedHistory', { n: imported })}</Text>
                  : imported === 0 ? <Text style={[s.faint, { marginTop: 10, textAlign: 'center' }]} selectable>{tr('importedNone', { d: diag ?? '—' })}</Text> : null}
                <View style={{ height: 16 }} />
                <Button title={tr('done')} onPress={() => onLinked(store.id)} />
              </View>
            ) : (
              <>
                <View style={{ backgroundColor: t.accentSoft, paddingHorizontal: 16, paddingVertical: 10 }}>
                  <Text style={[s.small, { color: t.accent, fontWeight: '600' }]}>{store.loginKind === 'password' ? tr('linkTipPw') : tr('linkTipOtp')}</Text>
                  <View style={[s.rowStart, { marginTop: 8, gap: 8, flexWrap: 'wrap' }]}>
                    {store.forgotJs ? <Pressable onPress={createPassword} style={{ backgroundColor: t.ink, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 }}><Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{tr('createPwOnce')}</Text></Pressable> : null}
                    <Pressable onPress={() => setSignup(true)} style={{ borderWidth: 1, borderColor: t.ink, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14 }}><Text style={{ color: t.ink, fontWeight: '700', fontSize: 13 }}>{tr('cloudNoAccount', { s: store.name })}</Text></Pressable>
                  </View>
                </View>
                {guard ? (
                  <View style={{ backgroundColor: guard === 'blocked' ? '#FDECEC' : '#FFF6DF', paddingHorizontal: 16, paddingVertical: 10 }} testID="link-guard">
                    <Text style={[s.small, { color: t.ink, fontWeight: '600' }]}>{guard === 'blocked' ? tr('guardBlocked', { s: store.name }) : tr('guardChallenge', { s: store.name })}</Text>
                    {guard === 'blocked' ? (
                      <View style={[s.rowStart, { marginTop: 8, gap: 8 }]}>
                        <Pressable onPress={() => { setGuard(''); retried.current = false; (webref.current as unknown as { reload?: () => void } | null)?.reload?.(); }} style={{ borderWidth: 1, borderColor: t.ink, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14 }}><Text style={{ color: t.ink, fontWeight: '700', fontSize: 13 }}>{tr('tryAgain')}</Text></Pressable>
                        <Pressable onPress={() => { void Linking.openURL(store.loginUrl); }} style={{ backgroundColor: t.ink, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 }}><Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{tr('guardOpenBrowser')}</Text></Pressable>
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </>
            )}
            <View style={signup || signedIn ? HIDDEN : { flex: 1, overflow: 'hidden' }} pointerEvents={signup || signedIn ? 'none' : 'auto'}>
              <WebView
                ref={(r) => { webref.current = r; }}
                source={{ uri: store.loginUrl }}
                sharedCookiesEnabled
                thirdPartyCookiesEnabled
                domStorageEnabled
                javaScriptCanOpenWindowsAutomatically
                // The login page's "reset password" and OTP steps use target=_blank;
                // keep them in this same WebView instead of dropping them.
                setSupportMultipleWindows={false}
                originWhitelist={['*']}
                // The WebView's own user agent: it already says iPhone, so stores serve the phone
                // flow; a WebView claiming to be Safari reads as spoofed to Cloudflare's checks
                // and Victory answered 403 before the person could do anything.
                onLoadEnd={settle}
                onError={onLoadError}
                onHttpError={(e: { nativeEvent: { statusCode?: number; url?: string } }) => { if ((e.nativeEvent.statusCode ?? 0) >= 400) void report({ httpError: e.nativeEvent }); }}
                renderError={() => (
                  <View style={[s.pad, { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: t.bg }]}>
                    <Text style={[s.body, { textAlign: 'center' }]}>{tr('storeLoadFailed', { s: store.name })}</Text>
                    <View style={{ height: 12 }} />
                    <Button title={tr('tryAgain')} kind="secondary" onPress={() => { setLoadErr(null); retried.current = false; (webref.current as unknown as { reload?: () => void } | null)?.reload?.(); }} />
                    {loadErr ? <Text style={[s.faint, { marginTop: 8 }]} selectable>{loadErr}</Text> : null}
                  </View>
                )}
                onMessage={(e: { nativeEvent: { data: string } }) => {
                  const d = e.nativeEvent.data;
                  if (d.startsWith('guard:')) { const g = d.slice(6) as '' | 'challenge' | 'blocked'; setGuard((prev) => (prev === g ? prev : g)); return; }
                  if (d === 'signedin:0') {
                    // The store's own page says "not signed in". A stale "connected" flag on this
                    // phone (an earlier misread, an expired session) is cleared after a few looks,
                    // so Me never keeps showing a store as connected that is not.
                    notIn.current += 1; seenIn.current = 0;
                    if (notIn.current === 3 && !signedInRef.current) markUnlinked(storeId);
                  }
                  // "Signed in" must hold on two looks in a row: a page mid-transition once read as
                  // signed in for a single poll and marked a store connected that was not.
                  if (d === 'signedin:1' && ++seenIn.current >= 2) onSignedIn('store');
                  else if (d.startsWith('session:')) { void postSession(d.slice(8)); }
                  else if (d.startsWith('history:')) { void postHistory(d.slice(8)); }
                  else if (d.startsWith('probe:')) { try { void report({ probe: JSON.parse(d.slice(6)) as unknown }); } catch { /* diagnostic only */ } }
                }}
              />
            </View>
            {signup || signedIn ? null : (
              <View style={[s.pad, { borderTopWidth: 1, borderColor: t.line, backgroundColor: t.card, paddingTop: 10 }]}>
                {/* The person is never stuck behind the detector: once they see
                    themselves signed in, one tap confirms it and starts the import. */}
                <Button title={tr('imSignedIn')} kind="secondary" icon="check" onPress={() => onSignedIn('person')} />
                <Text style={[s.faint, { textAlign: 'center', marginTop: 8 }]}>{tr('linkPrivacy')}</Text>
              </View>
            )}
          </>
        )}
      </View>
    </Modal>
  );
}
