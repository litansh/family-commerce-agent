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
import { markLinked, markNeedsRelink, useLinked } from './lib/linked';
import { confirmFromHistory } from './lib/pending';
import { HISTORY_JS } from './lib/inject';
import { BUILD } from './lib/config';
import { captureSessionJs, GUARD_JS, parseCapturedSession, sessionSummary } from './lib/session';

const EVERY_MS = 6 * 3600_000;
const KEY = (id: string) => `fca.keepalive.${id}`;

function Keeper({ storeId, api, householdId, onDone }: { storeId: string; api: Api; householdId: string; onDone: () => void }) {
  const store = STORES[storeId];
  const WebView = (() => { try { return require('react-native-webview').WebView as typeof import('react-native-webview').WebView; } catch { return null; } })();
  const ref = useRef<import('react-native-webview').WebView | null>(null);
  const looks = useRef<string[]>([]);
  const finished = useRef(false);
  const finish = (verdict: string) => {
    if (finished.current) return; finished.current = true;
    void AsyncStorage.setItem(KEY(storeId), String(Date.now()));
    void (async () => {
      // "Out" on one visit is a suspicion, not a verdict: a page that had not restored its session
      // once flagged a store the person was in fact signed in to. Only two "out" visits at least four
      // hours apart mark a store; any "in" clears the suspicion. The family is never asked on a guess.
      const OUT = `fca.keepalive.out.${storeId}`;
      let decided = verdict;
      if (verdict === 'out') {
        const first = Number((await AsyncStorage.getItem(OUT)) ?? 0);
        if (first && Date.now() - first > 4 * 3600_000) { markNeedsRelink(storeId); decided = 'out-confirmed-twice'; }
        else { if (!first) await AsyncStorage.setItem(OUT, String(Date.now())); decided = 'out-suspected'; }
      } else if (verdict === 'in') { await AsyncStorage.removeItem(OUT); markLinked(storeId); }
      void api.importHistory(householdId, storeId, [], { build: BUILD, keepalive: { verdict: decided, looks: looks.current } }).catch(() => null);
    })();
    onDone();
  };
  useEffect(() => { const t = setTimeout(() => finish('timeout'), 60_000); return () => clearTimeout(t); }, []);
  if (!store || !WebView) return null;
  const check = `(async()=>{try{const g=${GUARD_JS};if(g){window.ReactNativeWebView.postMessage('keep:'+g);return;}const ok=await (${store.signedInCheck});window.ReactNativeWebView.postMessage('keep:'+(ok?'in':'out'));}catch(e){window.ReactNativeWebView.postMessage('keep:err');}})();true;`;
  const promptCheck = `(()=>{try{const t=((document.body&&document.body.innerText)||'').replace(/\\s+/g,' ');const p=/(^|\\s)(כניסה|כניסת משתמש|התחברות|התחבר|כניסה לחשבון|הרשמה|log ?in|sign ?in)(\\s|$)/i.test(t)||!!document.querySelector('input[type="password"],input[type="tel"]');window.ReactNativeWebView.postMessage('keep:'+(p?'out-confirmed':'unclear'));}catch(e){window.ReactNativeWebView.postMessage('keep:unclear');}})();true;`;
  // The same capture the connect screen runs: the cloud copy is refreshed on every signed-in visit.
  const capture = captureSessionJs(store, 'keepsession');
  return (
    <View style={{ width: 1, height: 1, opacity: 0, position: 'absolute', left: -2, top: -2 }} pointerEvents="none">
      <WebView
        ref={(r) => { ref.current = r; }}
        source={{ uri: store.loginUrl }}
        sharedCookiesEnabled thirdPartyCookiesEnabled domStorageEnabled
        // Three looks, spread out: single-page stores restore their session a few seconds after load.
        onLoadEnd={() => { for (const ms of [5000, 11000, 18000]) setTimeout(() => ref.current?.injectJavaScript(check), ms); }}
        onError={() => finish('load-error')}
        onMessage={(e: { nativeEvent: { data: string } }) => {
          const d = e.nativeEvent.data;
          if (d.startsWith('history:')) {
            try {
              const env = JSON.parse(d.slice(8)) as { orders?: { at?: string; lines: { name: string; code?: string; qty?: number }[] }[]; diag?: Record<string, unknown> };
              const orders = (env.orders ?? []).map((o) => ({ at: o.at ?? '', lines: o.lines.map((l) => ({ name: l.name, ...(l.code ? { code: l.code } : {}), qty: l.qty ?? 1 })) }));
              void api.importHistory(householdId, storeId, orders, { build: BUILD, keepalive: true, ...(env.diag ?? {}) }).catch(() => null);
              confirmFromHistory(storeId, orders);
            } catch { /* a malformed report is only a report */ }
            finish('in'); return;
          }
          if (d.startsWith('keepsession:')) {
            // What was captured, and whether the cloud took it, both reach the log: a keep-alive
            // that finds a session and posts nothing is exactly the failure nobody would see.
            const got = parseCapturedSession(d.slice(12)); const sum = sessionSummary(got);
            const done = (extra: Record<string, unknown>) => api.importHistory(householdId, storeId, [], { build: BUILD, keepalive: { sessionCapture: { ...sum, ...extra } } }).catch(() => null);
            if (sum.cookies + sum.tokens === 0) { void done({ empty: true }); return; }
            void api.postStoreSession(householdId, storeId, { cookies: got.cookies, tokens: got.tokens, ...(got.userAgent ? { userAgent: got.userAgent } : {}) }).then((r) => done({ saved: r.connected }), (e: unknown) => done({ saved: false, postError: String(e).slice(0, 200) }));
            return;
          }
          if (!d.startsWith('keep:')) return;
          const v = d.slice(5); looks.current.push(v);
          // Two looks agree before a verdict; a challenge or block is neither "in" nor "out".
          if (v === 'in') {
            ref.current?.injectJavaScript(capture);
            // Signed in: read the store's own orders too - the memory learns from what was really
            // bought, and a cart Kaniti filled earlier is confirmed without asking anyone.
            const h = store.historyJs ?? (storeId === 'shufersal' ? HISTORY_JS : undefined);
            if (h) { ref.current?.injectJavaScript(h); setTimeout(() => finish('in'), 12_000); } else finish('in');
          }
          // "Out" only when three looks agree AND the store is actually showing its sign-in: a page still
          // booting reads as out too, and a wrong "needs re-connecting" costs the family trust.
          else if (v === 'out' && looks.current.filter((x) => x === 'out').length >= 3) { ref.current?.injectJavaScript(promptCheck); }
          else if (v === 'out-confirmed') finish('out');
          else if (v === 'unclear') finish('unclear');
          else if (v === 'challenge' || v === 'blocked') finish(v);
          else if (looks.current.length >= 3) finish(looks.current.join(','));
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
