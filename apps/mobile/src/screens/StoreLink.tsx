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
export function StoreLink({ storeId, onClose, onLinked }: { storeId: string; onClose: () => void; onLinked: (id: string) => void }) {
  const s = S();
  const store = STORES[storeId];
  const [signedIn, setSignedIn] = useState(false);
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
                  if (e.nativeEvent.data === 'signedin:1') setSignedIn(true);
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
