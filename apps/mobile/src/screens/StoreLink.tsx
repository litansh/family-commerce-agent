import React, { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Text, View } from 'react-native';
import { STORES } from '../lib/stores';
import { t as tr } from '../lib/i18n';
import { Button, S, t } from '../ui';
import { Pressable } from 'react-native';
import { isRTL } from '../lib/i18n';

/**
 * Connect a store, entirely inside Kanili.
 *
 * The store's own login opens in a WebView, so the OS autofills a saved
 * password with Face ID, or the person enters the SMS code — the very page
 * the store's own app uses, which is why "already have an account" and "new"
 * are one flow. Every couple of seconds Kanili asks the store's own page
 * whether it is signed in; when it says yes, the store is connected. The
 * session stays in the WebView, on the device — nothing is sent to a server.
 *
 * On the web there is no WebView (stores forbid being framed), so this asks
 * the person to use the app rather than half-working.
 */
export function StoreLink({ storeId, api, householdId, onClose, onLinked }: { storeId: string; api: import('../lib/api').Api; householdId: string; onClose: () => void; onLinked: (id: string) => void }) {
  const s = S();
  const store = STORES[storeId];
  const [signedIn, setSignedIn] = useState(false);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<number | null>(null);
  const didImport = useRef(false);
  const webref = useRef<import('react-native-webview').WebView | null>(null);

  // Native module: require lazily so the web build still loads.
  const WebView = Platform.OS === 'web' ? null : (() => { try { return require('react-native-webview').WebView as typeof import('react-native-webview').WebView; } catch { return null; } })();

  // Poll the store's own signed-in check through the WebView.
  useEffect(() => {
    if (!WebView) return;
    const id = setInterval(() => {
      const js = `(async()=>{try{const ok=await (${store!.signedInCheck});window.ReactNativeWebView.postMessage('signedin:'+(ok?'1':'0'));}catch(e){window.ReactNativeWebView.postMessage('signedin:0');}})();true;`;
      (webref.current as unknown as { injectJavaScript?: (s: string) => void } | null)?.injectJavaScript?.(js);
    }, 2500);
    return () => clearInterval(id);
  }, [WebView, store]);

  const [diag, setDiag] = useState<string | null>(null);
  const postHistory = async (json: string): Promise<void> => {
    try {
      const parsed = JSON.parse(json) as unknown;
      const env = Array.isArray(parsed) ? { orders: parsed, diag: undefined } : (parsed as { orders?: unknown[]; diag?: Record<string, unknown> });
      const orders = Array.isArray(env.orders) ? env.orders : [];
      if (env.diag) setDiag(JSON.stringify(env.diag));
      // Always post, even with nothing: the diagnostic reaches the server log
      // so a wrong shape can be fixed without a phone in hand.
      const r = await api.importHistory(householdId, storeId, orders as never, env.diag);
      setImported(r.orders);
    } catch (e) { setImported(0); setDiag(String(e)); } finally { setImporting(false); }
  };

  if (!store) return null;
  const hint = store.loginKind === 'otp' ? tr('linkHintOtp', { s: store.name }) : tr('linkHintPw', { s: store.name });

  const rtl = isRTL();
  return (
    <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={[s.screen, { paddingTop: 8 }]}>
        {/* Solid close bar, always on top of the WebView. */}
        <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: t.line, backgroundColor: t.card, zIndex: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={[s.title, { fontSize: 18, textAlign: rtl ? 'right' : 'left' }]}>{tr('connectStore', { s: store.name })}</Text>
            <Text style={[s.small, { textAlign: rtl ? 'right' : 'left' }]}>{hint}</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={16} style={{ backgroundColor: t.bg, borderRadius: 999, width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginRight: rtl ? 0 : 4, marginLeft: rtl ? 4 : 0 }}>
            <Text style={{ fontSize: 20, color: t.ink, fontWeight: '700' }}>✕</Text>
          </Pressable>
        </View>
        {!WebView ? (
          <View style={[s.pad, { flex: 1, justifyContent: 'center' }]}>
            <Text style={[s.body, { textAlign: 'center', marginBottom: 16 }]}>{tr('linkNeedsApp')}</Text>
            <Button title={tr('ok')} onPress={onClose} kind="secondary" />
          </View>
        ) : signedIn ? (
          <View style={[s.pad, { flex: 1, justifyContent: 'center', alignItems: 'center' }]}>
            <Text style={{ fontSize: 48 }}>✓</Text>
            <Text style={[s.title, { marginTop: 12, textAlign: 'center' }]}>{tr('linked', {})}</Text>
            <Text style={[s.body, { color: t.muted, textAlign: 'center', marginTop: 6 }]}>{tr('linkedSub', { s: store.name })}</Text>
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
            </View>
            <View style={{ flex: 1, overflow: 'hidden' }}>
              <WebView
                ref={(r) => { webref.current = r; }}
                source={{ uri: store.loginUrl }}
                sharedCookiesEnabled
                thirdPartyCookiesEnabled
                onMessage={(e: { nativeEvent: { data: string } }) => {
                  const d = e.nativeEvent.data;
                  if (d === 'signedin:1') { setSignedIn(true); if (!didImport.current && storeId === 'shufersal') { didImport.current = true; setImporting(true); (webref.current as unknown as { injectJavaScript?: (s: string) => void } | null)?.injectJavaScript?.(HISTORY_JS); } }
                  else if (d.startsWith('history:')) { void postHistory(d.slice(8)); }
                }}
              />
            </View>
            <View style={[s.pad, { borderTopWidth: 1, borderColor: t.line, backgroundColor: t.card }]}>
              <Text style={[s.faint, { textAlign: 'center' }]}>{tr('linkPrivacy')}</Text>
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
const HISTORY_JS = `(async()=>{let diagHtml;try{
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
