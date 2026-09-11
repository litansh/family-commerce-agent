/**
 * Once connected, stay connected.
 *
 * A store's session lives in this phone's WebView cookie jar. Stores let idle
 * sessions lapse after days or weeks; a family that shops every week or two
 * would meet the store's login again and again. So, quietly, whenever the app
 * comes to the foreground (at most once every few hours per store), each
 * connected store's page is opened in a hidden WebView: the visit keeps the
 * session warm, the store's own signed-in check says whether it still holds,
 * and the sealed copy in the cloud is refreshed. A session that has lapsed is
 * not silently dropped: the store is marked "needs re-connecting" and the Me
 * screen says exactly what to do (the same 20-second SMS-code flow).
 */
import React, { useEffect, useRef, useState } from 'react';
import { AppState, Platform, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Api } from './lib/api';
import { STORES } from './lib/stores';
import { markNeedsRelink, useLinked } from './lib/linked';
import { BUILD } from './lib/config';

const EVERY_MS = 6 * 3600_000;
const KEY = (id: string) => `fca.keepalive.${id}`;

const GUARD = `(()=>{try{const t=(document.title+' '+((document.body&&document.body.innerText)||'').slice(0,600));if(/Sorry, you have been blocked|Error 1020|Access denied|has been blocked/i.test(t))return 'blocked';if(document.querySelector('#challenge-form,#challenge-running,#challenge-stage,.cf-turnstile,[id^="cf-chl"],iframe[src*="challenges.cloudflare.com"]')||/cdn-cgi\\/challenge/.test(location.href)||/Just a moment|Attention Required|Verify you are human|Checking your browser/i.test(t))return 'challenge';}catch(e){}return '';})()`;

function Keeper({ storeId, api, householdId, onDone }: { storeId: string; api: Api; householdId: string; onDone: () => void }) {
  const store = STORES[storeId];
  const WebView = (() => { try { return require('react-native-webview').WebView as typeof import('react-native-webview').WebView; } catch { return null; } })();
  const ref = useRef<import('react-native-webview').WebView | null>(null);
  const looks = useRef<string[]>([]);
  const finished = useRef(false);
  const finish = (verdict: string) => {
    if (finished.current) return; finished.current = true;
    void AsyncStorage.setItem(KEY(storeId), String(Date.now()));
    void api.importHistory(householdId, storeId, [], { build: BUILD, keepalive: { verdict, looks: looks.current } }).catch(() => null);
    if (verdict === 'out') markNeedsRelink(storeId);
    onDone();
  };
  useEffect(() => { const t = setTimeout(() => finish('timeout'), 45_000); return () => clearTimeout(t); }, []);
  if (!store || !WebView) return null;
  const check = `(async()=>{try{const g=${GUARD};if(g){window.ReactNativeWebView.postMessage('keep:'+g);return;}const ok=await (${store.signedInCheck});window.ReactNativeWebView.postMessage('keep:'+(ok?'in':'out'));}catch(e){window.ReactNativeWebView.postMessage('keep:err');}})();true;`;
  const capture = `(()=>{try{const keys=${JSON.stringify(store.sessionKeys ?? [])};const cookies=document.cookie.split(';').map(c=>c.trim()).filter(Boolean).map(c=>{const i=c.indexOf('=');return {name:c.slice(0,i),value:decodeURIComponent(c.slice(i+1)),domain:location.hostname}});const tokens={};try{for(const k of Object.keys(localStorage)){if(keys.includes(k)||/token/i.test(k)){const v=localStorage.getItem(k);if(v&&v.length>8&&v.length<4000)tokens[k]=v;}}}catch(e){}window.ReactNativeWebView.postMessage('keepsession:'+JSON.stringify({cookies,tokens,userAgent:navigator.userAgent}));}catch(e){}})();true;`;
  return (
    <View style={{ width: 1, height: 1, opacity: 0, position: 'absolute', left: -2, top: -2 }} pointerEvents="none">
      <WebView
        ref={(r) => { ref.current = r; }}
        source={{ uri: store.loginUrl }}
        sharedCookiesEnabled thirdPartyCookiesEnabled domStorageEnabled
        onLoadEnd={() => { setTimeout(() => ref.current?.injectJavaScript(check), 4000); setTimeout(() => ref.current?.injectJavaScript(check), 9000); }}
        onError={() => finish('load-error')}
        onMessage={(e: { nativeEvent: { data: string } }) => {
          const d = e.nativeEvent.data;
          if (d.startsWith('keepsession:')) { const got = JSON.parse(d.slice(12)) as { cookies: { name: string; value: string; domain?: string }[]; tokens: Record<string, string>; userAgent?: string }; void api.postStoreSession(householdId, storeId, { cookies: got.cookies, tokens: got.tokens, ...(got.userAgent ? { userAgent: got.userAgent } : {}) }).catch(() => null); return; }
          if (!d.startsWith('keep:')) return;
          const v = d.slice(5); looks.current.push(v);
          // Two looks agree before a verdict; a challenge or block is neither "in" nor "out".
          if (v === 'in') { ref.current?.injectJavaScript(capture); finish('in'); }
          else if (v === 'out' && looks.current.filter((x) => x === 'out').length >= 2) finish('out');
          else if (v === 'challenge' || v === 'blocked') finish(v);
          else if (looks.current.length >= 2) finish(looks.current.join(','));
        }}
      />
    </View>
  );
}

/** Mounted once, next to the tabs. Runs the keepers one at a time, on foreground, when due. */
export function SessionKeeper({ api, householdId }: { api: Api; householdId: string }) {
  const linked = useLinked();
  const [queue, setQueue] = useState<string[]>([]);
  const running = useRef(false);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const kick = async () => {
      if (running.current) return;
      const due: string[] = [];
      for (const id of linked) {
        const last = Number((await AsyncStorage.getItem(KEY(id))) ?? 0);
        if (Date.now() - last > EVERY_MS) due.push(id);
      }
      if (due.length) { running.current = true; setQueue(due); }
    };
    void kick();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') void kick(); });
    return () => sub.remove();
  }, [linked]);
  const current = queue[0];
  if (!current) { running.current = false; return null; }
  return <Keeper key={current} storeId={current} api={api} householdId={householdId} onDone={() => setQueue((q) => q.slice(1))} />;
}
