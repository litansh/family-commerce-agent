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

/**
 * Connect a store, entirely inside Kaniti.
 *
 * The store's own login opens in a WebView, so the OS autofills a saved
 * password with Face ID, or the person enters the SMS code — the very page
 * the store's own app uses, which is why "already have an account" and "new"
 * are one flow. Every couple of seconds Kaniti asks the store's own page
 * whether it is signed in; when it says yes, the store is connected. The
 * session stays in the WebView, on the device — nothing is sent to a server.
 *
 * On the web there is no WebView (stores forbid being framed), so the web
 * takes the cloud rung instead (`CloudConnect`, ADR 0008): a password typed
 * once where the store allows it, and an honest "from your phone" where the
 * store gates sign-in behind a captcha.
 *
 * After a native sign-in the session is captured (the cookies the page can
 * read, plus the store's token names) and sent to the cloud, so the family's
 * other devices - and the web - see the store as connected too.
 */
export function StoreLink({ storeId, api, householdId, onClose, onLinked }: { storeId: string; api: import('../lib/api').Api; householdId: string; onClose: () => void; onLinked: (id: string) => void }) {
  const s = S();
  const store = STORES[storeId];
  const [signedIn, setSignedIn] = useState(false);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<number | null>(null);
  const didImport = useRef(false);
  const notIn = useRef(0);
  const seenIn = useRef(0);
  // A store page that fails to load (a cancelled redirect, a hiccup) retries once by
  // itself and is reported; the person sees a plain "try again", never a raw error page.
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const retried = useRef(false);
  const onLoadError = (e: { nativeEvent: { code?: number; description?: string; url?: string; domain?: string } }) => {
    const ev = e.nativeEvent;
    void api.importHistory(householdId, storeId, [], { build: BUILD, loadError: { code: ev.code, description: ev.description, url: ev.url, domain: ev.domain } }).catch(() => null);
    if (ev.code === -999 && !retried.current) { retried.current = true; setTimeout(() => (webref.current as unknown as { reload?: () => void } | null)?.reload?.(), 800); return; } // cancelled: the store redirected mid-load
    if (!retried.current) { retried.current = true; setTimeout(() => (webref.current as unknown as { reload?: () => void } | null)?.reload?.(), 1200); return; }
    setLoadErr(ev.description ?? 'load error');
  };
  const webref = useRef<import('react-native-webview').WebView | null>(null);

  // Cloudflare in front of a store (Victory) may put a "verify you are human" step, or a
  // flat block page, where the login should be. The challenge is the person's to click:
  // nothing is injected or clicked while it is on screen, and the app says what it is.
  // A block page gets an "open in Safari" way out. Evaluates to 'challenge' | 'blocked' | ''.
  const GUARD_TEST = `(()=>{try{const t=(document.title+' '+((document.body&&document.body.innerText)||'').slice(0,600));if(/Sorry, you have been blocked|Error 1020|Access denied|has been blocked/i.test(t))return 'blocked';if(document.querySelector('#challenge-form,#challenge-running,#challenge-stage,#challenge-error-text,.cf-turnstile,[id^="cf-chl"],iframe[src*="challenges.cloudflare.com"]')||/cdn-cgi\/challenge/.test(location.href)||/Just a moment|Attention Required|Verify you are human|Checking your browser|אימות אנושי/i.test(t))return 'challenge';}catch(e){}return '';})()`;
  const [guard, setGuard] = useState<'' | 'challenge' | 'blocked'>('');
  const guarded = (js: string) => `(()=>{const g=${GUARD_TEST};window.ReactNativeWebView.postMessage('guard:'+g);if(g)return;${js}})();true;`;

  // Native module: require lazily so the web build still loads.
  const WebView = Platform.OS === 'web' ? null : (() => { try { return require('react-native-webview').WebView as typeof import('react-native-webview').WebView; } catch { return null; } })();

  // Poll the store's own signed-in check through the WebView.
  const ticks = useRef(0);
  useEffect(() => {
    if (!WebView) return;
    const id = setInterval(() => {
      ticks.current += 1;
      // While a code box is on screen, do not run the signed-in check: Shufersal's
      // check fetches /my-account, which redirects and can disturb the OTP page.
      const js = `(async()=>{try{const g=${GUARD_TEST};window.ReactNativeWebView.postMessage('guard:'+g);if(g)return;if(document.querySelector('input[autocomplete="one-time-code"]')){window.ReactNativeWebView.postMessage('signedin:0');return;}const ok=await (${store!.signedInCheck});window.ReactNativeWebView.postMessage('signedin:'+(ok?'1':'0'));}catch(e){window.ReactNativeWebView.postMessage('signedin:0');}})();true;`;
      (webref.current as unknown as { injectJavaScript?: (s: string) => void } | null)?.injectJavaScript?.(js);
      // Once, after a few seconds: report what the check actually sees, so a
      // silent "connected but nothing happens" is debuggable from the server log.
      if (ticks.current === 4 || ticks.current === 24) (webref.current as unknown as { injectJavaScript?: (s: string) => void } | null)?.injectJavaScript?.(PROBE_JS);
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
  const inject = (js?: string) => { if (js) (webref.current as unknown as { injectJavaScript?: (s: string) => void } | null)?.injectJavaScript?.(guarded(js)); };
  // The moment a store shows a "code" box, mark it as a one-time-code field
  // and focus it. iOS then offers the SMS code on the keyboard as it lands —
  // one tap, well inside the store's timer — instead of a race to type six
  // digits from Messages. Runs continuously: code boxes appear after taps.
  const OTP_JS = `(()=>{if(window.__kanitiOtp)return;window.__kanitiOtp=1;
    // Strict: a code box is a short field (4-8 chars) whose own name/id/autocomplete says so.
    // Never a 20-char text field that merely mentions a word - rewriting those broke Shufersal's forms.
    const isCode=(i)=>{if(i.type==='tel'||i.type==='password'||i.type==='email'||i.type==='search')return false;const n=(i.name||'')+' '+(i.id||'');const ac=i.getAttribute('autocomplete')||'';if(/phone|tel|zip|idNumber|birth/i.test(n))return false;const ml=Number(i.getAttribute('maxlength')||0);if(ac==='one-time-code')return true;if(ml<4||ml>8)return false;return /otp|sms.?code|smscode|one.?time|verif|code$|^code|_code|codeinput/i.test(n)||i.getAttribute('inputmode')==='numeric'||/^\\\\d\\*$/.test(i.getAttribute('pattern')||'');};
    const fire=(i)=>{for(const t of ['input','keydown','keyup','change'])try{i.dispatchEvent(t==='input'?new Event('input',{bubbles:true}):t==='change'?new Event('change',{bubbles:true}):new KeyboardEvent(t,{bubbles:true,key:'0'}));}catch(e){}};
    const submitOf=(i)=>{const f=i.closest('form');const c=f||document;
      // NEVER the "send/resend a code" button - clicking it invalidates the code the person just typed.
      const resend=(t)=>/שלח.*קוד|קוד.*חדש|resend|send.*code|get.*code/i.test(t);
      const label=(x)=>((x.textContent||x.value||'')+' '+(x.getAttribute('aria-label')||'')).trim();
      const btns=[...c.querySelectorAll('button,input[type="submit"],a.btn,[role="button"]')].filter(x=>x.getBoundingClientRect().width>0&&!x.disabled&&!resend(label(x)));
      // Confirm/continue only. Prefer an exact "אישור"/verify; then a contains match.
      return btns.find(x=>/^(אישור|אמת|המשך|כניסה|התחבר|verify|confirm|continue|submit|ok)$/i.test(label(x)))||btns.find(x=>/אישור|אמת|המשך|כניסה|התחבר|verify|confirm|continue|submit/i.test(label(x)))||null;};
    const report=(i,why)=>{try{const f=i.closest('form');const out={why,href:location.href,field:{name:i.name,id:i.id,type:i.type,ml:i.maxLength,ac:i.getAttribute('autocomplete'),len:(i.value||'').length},form:f?{id:f.id,action:f.getAttribute('action'),method:f.method}:null,buttons:[...(f||document).querySelectorAll('button,input[type="submit"]')].filter(x=>x.getBoundingClientRect().width>0).map(x=>((x.textContent||x.value||'').trim().slice(0,30)+(x.disabled?'(disabled)':''))).slice(0,8),text:(document.body.innerText||'').replace(/\\\\s+/g,' ').slice(0,300)};window.ReactNativeWebView.postMessage('probe:'+JSON.stringify(out));}catch(e){}};
    // Password autofill (iOS Passwords + Face ID, Android Autofill) offers a saved login only when
    // the fields carry the standard markers; many stores omit them. Add, never overwrite.
    const autofill=()=>{try{const pw=[...document.querySelectorAll('input[type="password"]')].filter(x=>x.getBoundingClientRect().width>0);for(const p of pw){if(!p.getAttribute('autocomplete'))p.setAttribute('autocomplete','current-password');const f=p.closest('form')||document;const u=[...f.querySelectorAll('input[type="email"],input[type="text"],input[type="tel"]')].filter(x=>x!==p&&x.getBoundingClientRect().width>0&&!isCode(x))[0];if(u&&!u.getAttribute('autocomplete'))u.setAttribute('autocomplete',u.type==='tel'?'tel':'username');}}catch(e){}};
    const tune=()=>{autofill();for(const i of document.querySelectorAll('input')){if(i.type==='hidden'||i.type==='password'||i.type==='email'||i.type==='search')continue;if(!isCode(i))continue;
      if(i.getAttribute('autocomplete')!=='one-time-code'){i.setAttribute('autocomplete','one-time-code');i.setAttribute('inputmode','numeric');i.setAttribute('pattern','[0-9]*');}
      if(!i.dataset.kanitiWired){i.dataset.kanitiWired='1';report(i,'code box seen');
        // A pasted / autofilled code arrives as one input event; sites that listen for keyup never see it.
        // Replay the key events, and when the code is complete, press the page's own continue button.
        // Replay the key events a paste / autofill skips, so the page's own validation runs.
        // Nothing is clicked for the person: the page's confirm button is theirs to tap.
        i.addEventListener('input',()=>{fire(i);const v=(i.value||'').trim();if(v.length>=(i.maxLength>0?i.maxLength:6))report(i,'code complete: '+(submitOf(i)?'confirm button present':'no confirm button'));});}}};
    tune();new MutationObserver(()=>tune()).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style']});})();true;`;
  // Cookie / consent sheets sit on top of many store logins (Wolt, Hatzi Hinam). Take the
  // minimal choice for the person ("use only necessary" / "אישור" / close) so the login is reachable.
  const CONSENT_JS = `(()=>{try{const vis=(e)=>e.getBoundingClientRect().width>0;const ctx=(e)=>{let n=e,d=0;while(n&&d<6){const t=((n.id||'')+' '+(n.className||'')+' '+(n.getAttribute&&n.getAttribute('aria-label')||'')).toLowerCase();if(/cookie|consent|gdpr|privacy|onetrust|cc-|banner/.test(t))return true;n=n.parentElement;d++;}return false;};
    const btns=[...document.querySelectorAll('button,a,[role="button"]')].filter(vis);
    const pick=btns.find(b=>/use only necessary|only necessary|necessary only|reject all|decline/i.test(b.textContent||''))||btns.find(b=>ctx(b)&&/^\\s*(accept|allow|agree|ok|got it|אישור|מאשר|הבנתי|סגור|אשר|קיבלתי)\\s*$/i.test(b.textContent||''));
    if(pick){pick.click();window.ReactNativeWebView.postMessage('probe:'+JSON.stringify({why:'consent dismissed',label:(pick.textContent||'').trim().slice(0,40)}));}}catch(e){}})();true;`;
  const settle = () => {
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
  // where the full session lives (ADR 0008 amendment).
  const CAPTURE_JS = `(()=>{try{const keys=${JSON.stringify(store?.sessionKeys ?? [])};const cookies=document.cookie.split(';').map(c=>c.trim()).filter(Boolean).map(c=>{const i=c.indexOf('=');return {name:c.slice(0,i),value:decodeURIComponent(c.slice(i+1)),domain:location.hostname}});const tokens={};try{for(const k of Object.keys(localStorage)){if(keys.includes(k)||/token/i.test(k)){const v=localStorage.getItem(k);if(v&&v.length>8&&v.length<4000)tokens[k]=v;}}}catch(e){}window.ReactNativeWebView.postMessage('session:'+JSON.stringify({cookies,tokens,userAgent:navigator.userAgent}));}catch(e){window.ReactNativeWebView.postMessage('session:'+JSON.stringify({cookies:[],tokens:{},error:String(e)}));}})();true;`;
  const postSession = async (json: string): Promise<void> => {
    try {
      const got = JSON.parse(json) as { cookies: { name: string; value: string; domain?: string }[]; tokens: Record<string, string>; userAgent?: string };
      const cookies = got.cookies;
      const r = await api.postStoreSession(householdId, storeId, { cookies, tokens: got.tokens, ...(got.userAgent ? { userAgent: got.userAgent } : {}) });
      setSaved(r.connected);
    } catch { setSaved(false); }
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
      const r = await api.importHistory(householdId, storeId, orders as never, env.diag);
      setImported(r.orders);
    } catch (e) { setImported(0); setDiag(String(e)); } finally { setImporting(false); }
  };

  if (!store) return null;
  // The web's copy lives in CloudConnect; the header keeps only the store name there.
  const hint = !WebView ? '' : store.loginKind === 'otp' ? tr('linkHintOtp', { s: store.name }) : tr('linkHintPw', { s: store.name });

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
        ) : signup ? (
          <SignupGuide store={store} api={api} householdId={householdId} email={email} onOpen={() => { setSignup(false); (webref.current as unknown as { injectJavaScript?: (s: string) => void } | null)?.injectJavaScript?.(`location.href=${JSON.stringify(store.signup.url)};true;`); }} onBack={() => setSignup(false)} />
        ) : signedIn ? (
          <View style={[s.pad, { flex: 1, justifyContent: 'center', alignItems: 'center' }]}>
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
            <View style={{ flex: 1, overflow: 'hidden' }}>
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
                onHttpError={(e: { nativeEvent: { statusCode?: number; url?: string } }) => { if ((e.nativeEvent.statusCode ?? 0) >= 400) void api.importHistory(householdId, storeId, [], { build: BUILD, httpError: e.nativeEvent }).catch(() => null); }}
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
                    if (notIn.current === 3) markUnlinked(storeId);
                  }
                  // "Signed in" must hold on two looks in a row: a page mid-transition once read as
                  // signed in for a single poll and marked a store connected that was not.
                  if (d === 'signedin:1' && ++seenIn.current >= 2) {
                    setSignedIn(true);
                    // The store itself says the person is in: any "needs re-connecting" suspicion is wrong, clear it now.
                    markLinked(storeId);
                    if (!didImport.current) { didImport.current = true; inject(PROBE_JS); inject(CAPTURE_JS); const h = store?.historyJs ?? (storeId === 'shufersal' ? HISTORY_JS : undefined); if (h) { setImporting(true); inject(h); } }
                  }
                  else if (d.startsWith('session:')) { void postSession(d.slice(8)); }
                  else if (d.startsWith('history:')) { void postHistory(d.slice(8)); }
                  else if (d.startsWith('probe:')) { try { void api.importHistory(householdId, storeId, [], { build: BUILD, probe: JSON.parse(d.slice(6)) as unknown }); } catch { /* diagnostic only */ } }
                }}
              />
            </View>
            <View style={[s.pad, { borderTopWidth: 1, borderColor: t.line, backgroundColor: t.card, paddingTop: 10 }]}>
              {/* The person is never stuck behind the detector: once they see
                  themselves signed in, one tap confirms it and starts the import. */}
              <Button title={tr('imSignedIn')} kind="secondary" icon="check" onPress={() => { setSignedIn(true); if (!didImport.current) { didImport.current = true; inject(PROBE_JS); inject(CAPTURE_JS); const h = store?.historyJs ?? (storeId === 'shufersal' ? HISTORY_JS : undefined); if (h) { setImporting(true); inject(h); } } }} />
              <Text style={[s.faint, { textAlign: 'center', marginTop: 8 }]}>{tr('linkPrivacy')}</Text>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}


/**
 * Injected into the logged-in Shufersal WebView: pull recent orders through
 * the same-origin session and post them back.
 *
 * Shufersal's storefront has shipped several shapes for the orders JSON, so
 * the script reads every one it has seen (closedOrders / orders / results /
 * data; entries / orderEntries / lines; product.ean / barcode / code) and
 * falls back gracefully. It always posts a small `diag` alongside the orders
 * — the HTTP status, the top-level keys it found, and how many orders it
 * read — so a run that finds nothing tells us exactly why instead of
 * silently doing nothing.
 */
/** What the signed-in check sees: page URL, the orders request's status and final URL, and whether the page looks logged in. */
const PROBE_JS = `(async()=>{try{
  const out={href:location.href,title:document.title};
  // Every same-origin API call the page has made so far - the map of the store's real endpoints.
  // Same-origin paths and cross-origin API hosts alike: the shared platform keeps its API on another host.
  out.api=[...new Set(performance.getEntriesByType('resource').map(e=>e.name).filter(u=>/\\/api\\/|\\/rest\\/|graphql|json|my-account|order|cart|history|user|auth|login|session|customer|token/i.test(u)&&!/google|facebook|datadog|analytics|gtm|hotjar|cloudflare|\\.(png|jpe?g|svg|woff2?|css)(\\?|$)/i.test(u)).map(u=>u.replace(/^https?:\\/\\//,'').replace(location.host,'').slice(0,150)))].slice(0,40);
  if(location.hostname.includes('shufersal')){const r=await fetch('/online/he/my-account/orders',{credentials:'include'});const t=await r.text();Object.assign(out,{status:r.status,url:r.url,len:t.length,loginInPage:/login|התחבר|כניסה/i.test(t.slice(0,6000)),logoutLink:!!document.querySelector('a[href*="logout"]')});}
  out.bodyHead=document.body?document.body.innerText.slice(0,240).replace(/\\s+/g,' '):'';
  out.header=((document.querySelector('header')||{}).innerText||'').slice(0,200).replace(/\\s+/g,' ');
  try{const n=window.$nuxt;out.nuxt=!!n;out.authLoggedIn=n&&n.$auth?n.$auth.loggedIn:undefined;out.storeAuth=n&&n.$store&&n.$store.state&&n.$store.state.auth?Object.keys(n.$store.state.auth).slice(0,10):undefined;}catch(e){out.nuxtErr=String(e);}
  try{out.ls=Object.keys(localStorage).slice(0,20);}catch(e){}
  try{out.cookieNames=document.cookie.split(';').map(c=>c.trim().split('=')[0]).filter(Boolean).slice(0,20);}catch(e){}
  window.ReactNativeWebView.postMessage('probe:'+JSON.stringify(out));
}catch(e){window.ReactNativeWebView.postMessage('probe:'+JSON.stringify({error:String(e),href:location.href}));}})();true;`;

export const HISTORY_JS = `(async()=>{let diagHtml;try{
  const H={accept:'application/json','x-requested-with':'XMLHttpRequest'};
  const j=async(u)=>{const r=await fetch(u,{credentials:'include',headers:H});const t=await r.text();try{return {s:r.status,d:JSON.parse(t)}}catch(e){return {s:r.status,d:null,h:t.slice(0,400)}}};
  const L=await j('/online/he/my-account/orders');
  const root=(L.d&&typeof L.d==='object')?L.d:{};
  let arr=root.closedOrders||root.orders||root.results||root.data||root.orderHistory||[];
  if(arr&&!Array.isArray(arr)&&Array.isArray(arr.orders))arr=arr.orders;
  if(arr&&!Array.isArray(arr)&&Array.isArray(arr.results))arr=arr.results;
  if(!Array.isArray(arr))arr=[];
  const codes=arr.slice(0,20).map(o=>({code:o.code||o.orderCode||o.orderNumber||o.id||o.number,at:o.placed||o.created||o.date||o.orderDate||''})).filter(o=>o.code);
  const out=[];
  for(const o of codes){
    const D=await j('/online/he/my-account/orders/'+encodeURIComponent(o.code));
    const d=(D.d&&typeof D.d==='object')?D.d:{};
    const ents=d.entries||d.orderEntries||d.lines||d.items||(d.order&&(d.order.entries||d.order.lines))||[];
    const lines=(Array.isArray(ents)?ents:[]).map(e=>{const p=e.product||e;const n=p.name||p.productName||p.title||e.name;const c=p.ean||p.barcode||p.gtin||p.code||e.code;return n?{name:String(n),code:c?String(c):undefined,qty:Number(e.quantity||e.qty||1)||1}:null}).filter(x=>x&&!/משלוח|דמי/.test(x.name));
    if(lines.length)out.push({at:o.at,lines});
  }
  let via='json';
  if(out.length===0){
    // Fallback: the storefront is SAP Hybris; read the account pages as HTML.
    via='html';
    const html=async(u)=>{const r=await fetch(u,{credentials:'include'});return {s:r.status,t:await r.text()}};
    const P=new DOMParser();
    const list=await html('/online/he/my-account/orders?pageSize=20');
    const doc=P.parseFromString(list.t,'text/html');
    const links=[...doc.querySelectorAll('a[href*="/my-account/order"]')].map(a=>a.getAttribute('href')||'');
    const seen=new Set();const ocodes=[];
    for(const h of links){const m=h.match(/order[s]?\\/([A-Za-z0-9_-]+)/);if(m&&!seen.has(m[1])){seen.add(m[1]);ocodes.push({code:m[1],href:h});}}
    for(const o of ocodes.slice(0,20)){
      const d=await html(o.href.startsWith('http')?o.href:o.href.startsWith('/')?o.href:'/online/he/my-account/orders/'+o.code);
      const od=P.parseFromString(d.t,'text/html');
      const at=(od.querySelector('time')||{}).getAttribute?(od.querySelector('time').getAttribute('datetime')||od.querySelector('time').textContent||''):'';
      const rows=[...od.querySelectorAll('[data-product-code],[data-code],.productItem,.product-item,.cart-item,li.item,tr.item,.orderEntry,.entry')];
      const lines=[];
      for(const r of rows){
        const code=r.getAttribute('data-product-code')||r.getAttribute('data-code')||((r.querySelector('a[href*="/p/"]')||{}).getAttribute?(r.querySelector('a[href*="/p/"]').getAttribute('href')||'').match(/\\/p\\/P?_?(\\d{8,14})/)?.[1]:'')||'';
        const nameEl=r.querySelector('.name,.productName,.product-name,.title,a[href*="/p/"],h3,h4');
        const name=(nameEl?nameEl.textContent:r.textContent||'').replace(/\\s+/g,' ').trim().slice(0,80);
        const qEl=r.querySelector('.qty,.quantity,[data-qty],input[name*="qty" i]');
        const qty=Number(qEl?(qEl.value||qEl.getAttribute('data-qty')||qEl.textContent||'').replace(/[^\\d.]/g,''):1)||1;
        if(name&&name.length>2&&!/משלוח|דמי/.test(name))lines.push({name,code:code||undefined,qty});
      }
      if(lines.length)out.push({at,lines});
    }
    diagHtml={listStatus:list.s,orderLinks:ocodes.length,listTitle:(doc.querySelector('title')||{}).textContent||'',login:/login|התחבר/i.test(list.t.slice(0,4000))};
  }
  const diag={via,status:L.s,keys:Object.keys(root).slice(0,12),html:!!L.h,htmlHead:L.h?L.h.slice(0,120):undefined,found:codes.length,orders:out.length,...(typeof diagHtml!=='undefined'?{fallback:diagHtml}:{})};
  window.ReactNativeWebView.postMessage('history:'+JSON.stringify({orders:out,diag}));
}catch(e){window.ReactNativeWebView.postMessage('history:'+JSON.stringify({orders:[],diag:{error:String(e)}}));}})();true;`;
