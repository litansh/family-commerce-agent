import { useSafeAreaInsets } from 'react-native-safe-area-context';
import React, { useEffect, useRef, useState } from 'react';
import { Linking, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import type { Api } from '../lib/api';
import { STORES, type CartLine } from '../lib/stores';
import { isRTL, t as tr } from '../lib/i18n';
import { emptyTally, nextItem, readCount, type PerItemTally } from '../lib/basket';
import { Button, Chip, S, t } from '../ui';
import { BUILD } from '../lib/config';

/**
 * Ordering on the phone (ADR 0008 amendment): the store's own site, in the
 * person's own session, inside Kaniti. Nobody can block it - the store sees
 * exactly what it sees when the person shops.
 *
 * 1. The store's page loads in the WebView (signed in if the person connected
 *    it; otherwise the store's guest cart, which its checkout turns into a
 *    sign-in at the end - the store's own flow).
 * 2. The store's recipe runs inside the page: its own catalogue lookup, its own
 *    add-to-cart calls. Each line reports added / missing.
 * 3. The store's cart page is shown. The person checks it and pays on the
 *    store's own checkout - Kaniti never completes a payment (ADR 0006).
 * 4. "Done" teaches the family memory what was bought.
 *
 * Stores without a recipe yet get the honest version: each line's deep link,
 * one tap per item, in the same WebView.
 */
export function OrderOnDevice({ storeId, lines, api, householdId, onClose, onDone }: {
  storeId: string; lines: readonly CartLine[]; api: Api; householdId: string; onClose: () => void; onDone: (added: readonly CartLine[]) => void;
}) {
  const s = S();
  const rtl = isRTL();
  const store = STORES[storeId];
  const WebView = Platform.OS === 'web' ? null : (() => { try { return require('react-native-webview').WebView as typeof import('react-native-webview').WebView; } catch { return null; } })();
  const webref = useRef<import('react-native-webview').WebView | null>(null);
  const inject = (js?: string) => { if (js) (webref.current as unknown as { injectJavaScript?: (s: string) => void } | null)?.injectJavaScript?.(js); };

  type Phase = 'loading' | 'filling' | 'signin' | 'cart' | 'links';
  const [phase, setPhase] = useState<Phase>('loading');
  const [results, setResults] = useState<Record<string, 'added' | 'missing' | 'unavailable' | 'error'>>({});
  const [diag, setDiag] = useState<string | null>(null);
  const [linkIdx, setLinkIdx] = useState(0);
  const ran = useRef(false);
  const [uri, setUri] = useState<string>(store?.cartJs ? store.loginUrl : (lines.find((l) => l.link)?.link ?? store?.loginUrl ?? 'about:blank'));

  if (!store) return null;
  const hasRecipe = !!store.cartJs;
  const added = lines.filter((l) => l.gtin && results[l.gtin] === 'added');
  const count = (st: 'added' | 'missing' | 'unavailable' | 'error') => Object.values(results).filter((v) => v === st).length;

  // Deep-link mode: one line at a time, in the same WebView.
  // Every line gets a page at this store: its deep link when the quote has one, else the
  // store's own search for the product name - the universal last resort, any store.
  const linkLines = lines.map((l) => (l.link ? l : store?.searchUrl ? { ...l, link: store.searchUrl(l.name) } : l)).filter((l) => l.link);
  // Promise 9 for the per-item rung: an item counts as added only when the store's own basket number
  // rose while its page was on screen. `baseline` is that number when this item's page settled; a
  // store that does not publish a count (no `basketCountJs`) verifies nothing, and the screen says so
  // rather than implying the tap worked.
  const [tally, setTally] = useState<PerItemTally>(emptyTally);
  const nextLink = () => {
    const i = linkIdx + 1;
    setTally(nextItem);
    if (i < linkLines.length) { setLinkIdx(i); setUri(linkLines[i]!.link!); } else { setPhase('cart'); if (store.cartUrl) setUri(store.cartUrl); }
  };

  useEffect(() => { if (!hasRecipe) setPhase('links'); }, [hasRecipe]);

  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runRecipe = () => {
    ran.current = true; setPhase('filling'); setTimeout(() => inject(store.cartJs!(lines)), 1200);
    // Never stuck on "working": if the store's page does not answer, say so and move on.
    if (watchdog.current) clearTimeout(watchdog.current);
    watchdog.current = setTimeout(() => {
      setPhase((ph) => {
        if (ph !== 'filling') return ph;
        void api.importHistory(householdId, storeId, [], { build: BUILD, cart: { timeout: true } }).catch(() => null);
        setDiag('timeout');
        if (linkLines.length > 0) { setLinkIdx(0); setUri(linkLines[0]!.link!); return 'links'; }
        if (store.cartUrl) setUri(store.cartUrl);
        return 'cart';
      });
    }, 45000);
  };
  // On the store's cart page: ask the store how many lines IT holds, twice (its state hydrates late).
  const [storeCount, setStoreCount] = useState<number | null>(null);
  const onLoadEnd = () => {
    // Per-item flow: the family adds on the store's own page, tap by tap; read the
    // store's own count after each page too, the same way the cart page is read.
    if ((phase === 'cart' || phase === 'links') && store.basketCountJs) { for (const ms of [300, 1500, 4000]) setTimeout(() => inject(store.basketCountJs), ms); }
    if (!hasRecipe || ran.current) return;
    // Signed in already (a store the family connected)? fill now. Otherwise the
    // store's own login is on screen; we wait for the person to sign in, then fill.
    inject(`(async()=>{try{const ok=await (${store.signedInCheck});window.ReactNativeWebView.postMessage('signedin:'+(ok?'1':'0'));}catch(e){window.ReactNativeWebView.postMessage('signedin:0');}})();true;`);
    if (phase === 'loading') { setTimeout(() => { if (!ran.current) runRecipe(); }, 1500); } // guest stores (Rami Levy) fill without waiting
  };
  // Adding on a store's own product page does not reload anything, so a count read on page load is
  // stale exactly when it matters. While an item is on screen, keep asking the store.
  useEffect(() => {
    if (phase !== 'links' || !store.basketCountJs) return;
    const id = setInterval(() => inject(store.basketCountJs), 2500);
    return () => clearInterval(id);
  }, [phase, store, linkIdx]); // eslint-disable-line react-hooks/exhaustive-deps
  // While waiting for a sign-in, keep asking the store's page whether it is in yet.
  useEffect(() => {
    if (!hasRecipe) return;
    const id = setInterval(() => inject(`(async()=>{try{const ok=await (${store.signedInCheck});window.ReactNativeWebView.postMessage('signedin:'+(ok?'1':'0'));}catch(e){window.ReactNativeWebView.postMessage('signedin:0');}})();true;`), 2500);
    return () => clearInterval(id);
  }, [hasRecipe, store]); // eslint-disable-line react-hooks/exhaustive-deps

  const signedInOnce = useRef(false);
  const onMessage = (e: { nativeEvent: { data: string } }) => {
    const d = e.nativeEvent.data;
    if (d.startsWith('probe:')) { try { void api.importHistory(householdId, storeId, [], { build: BUILD, probe: JSON.parse(d.slice(6)) as unknown }).catch(() => null); } catch { /* diagnostic only */ } return; }
    if (d.startsWith('signedin:')) {
      const yes = d.endsWith('1');
      if (yes && !signedInOnce.current) {
        signedInOnce.current = true;
        // The person just signed in (or was already): fill the cart now, replacing any guest attempt.
        if (count('added') === 0) { setResults({}); runRecipe(); }
      }
      return;
    }
    if (d.startsWith('basket:')) {
      const n = Number(d.slice(7));
      if (Number.isFinite(n)) {
        setStoreCount(n);
        // Per-item flow: the first reading on an item's page is that item's baseline; the number
        // rising while the page is on screen is the store itself saying the tap worked. It is the
        // only proof there is here - our own side never touches this cart.
        if (phase === 'links') setTally((prev) => readCount(prev, linkIdx, n));
        // The store's count next to ours, in the log and (a mismatch) in the channel: no discrepancy goes unseen.
        void api.importHistory(householdId, storeId, [], { build: BUILD, basket: { store: n, added: phase === 'links' ? tally.verified.size : count('added'), ...(phase === 'links' ? { perItem: { item: linkIdx + 1, of: linkLines.length } } : {}) } }).catch(() => null);
      }
      return;
    }
    if (!d.startsWith('cart:')) return;
    if (watchdog.current) { clearTimeout(watchdog.current); watchdog.current = null; }
    try {
      const j = JSON.parse(d.slice(5)) as { results?: { gtin?: string; status: 'added' | 'missing' | 'unavailable' | 'error' }[]; cartUrl?: string; diag?: unknown };
      const r: Record<string, 'added' | 'missing' | 'unavailable' | 'error'> = {};
      for (const x of j.results ?? []) if (x.gtin) r[x.gtin] = x.status;
      setResults(r);
      setDiag(j.diag ? JSON.stringify(j.diag) : null);
      // The report reaches the server log too, so a wrong shape is fixable without a phone in hand.
      void api.importHistory(householdId, storeId, [], { build: BUILD, cart: { results: j.results, diag: j.diag } }).catch(() => null);
      const anyAdded = (j.results ?? []).some((x) => x.status === 'added');
      if (!anyAdded) {
        if (!signedInOnce.current) {
          // The store needs a sign-in it does not yet have. Its own login is on
          // screen; say so plainly and keep polling - a sign-in re-runs the fill.
          setPhase('signin');
          return;
        }
        if (linkLines.length > 0) { setPhase('links'); setLinkIdx(0); setUri(linkLines[0]!.link!); return; }
      }
      setPhase('cart');
      setUri(j.cartUrl ?? store.cartUrl ?? store.loginUrl);
    } catch (err) { setDiag(String(err)); setPhase('cart'); if (store.cartUrl) setUri(store.cartUrl); }
  };

  // What "done" may claim after the per-item flow: the items the store's own count confirmed, when
  // the store publishes one. When it does not, the whole list stays a question for the Orders tab
  // ("did you buy it?") — as it was — rather than becoming an answer nobody checked.
  const perItemDone = store.basketCountJs ? linkLines.filter((_l, i) => tally.verified.has(i)) : lines;

  const title = phase === 'cart' ? tr('cartReady', { s: store.name }) : phase === 'signin' ? tr('cartSignin', { s: store.name }) : phase === 'links' ? tr('cartLinks', { s: store.name, i: linkIdx + 1, n: linkLines.length }) : tr('cartFilling', { s: store.name });
  const sub = phase === 'cart' ? tr('cartReadySub') : phase === 'signin' ? tr('cartSigninSub', { s: store.name }) : phase === 'links' ? tr('cartLinksSub') : tr('cartFillingSub', { s: store.name });

  const insets = useSafeAreaInsets();
  return (
    <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      {/* A full-screen modal starts under the clock; the app provider's top inset keeps the close bar below it. */}
      <View style={[s.screen, { paddingTop: Math.max(insets.top, 20) + 4 }]}>
        <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: t.line, backgroundColor: t.card, zIndex: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={[s.title, { fontSize: 18, textAlign: rtl ? 'right' : 'left' }]} testID="order-title">{title}</Text>
            <Text style={[s.small, { textAlign: rtl ? 'right' : 'left' }]}>{sub}</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={16} testID="order-close" style={{ backgroundColor: t.bg, borderRadius: 999, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 20, color: t.ink, fontWeight: '700' }}>✕</Text>
          </Pressable>
        </View>

        {/* Per-item flow: the store's own number is the only one anybody can trust here — Kaniti does
            not touch this cart, the person does — so it is the only one shown, with "in the basket"
            appearing on the item whose tap the store's count confirmed. A store that publishes no
            count says so plainly instead of leaving the family to assume. */}
        {phase === 'links' ? (
          <View style={{ backgroundColor: t.accentSoft, paddingHorizontal: 16, paddingVertical: 8 }} testID="per-item-strip">
            {store.basketCountJs ? (
              <View style={[s.rowStart, { gap: 8, flexWrap: 'wrap' }]}>
                <Chip text={tr('storeBasket', { s: store.name, n: storeCount ?? 0 })} tone="neutral" />
                {tally.verified.has(linkIdx) ? <Chip text={tr('perItemIn')} tone="good" /> : null}
              </View>
            ) : (
              <Text style={[s.small, { textAlign: rtl ? 'right' : 'left' }]} testID="per-item-no-count">{tr('perItemNoCount', { s: store.name })}</Text>
            )}
          </View>
        ) : null}

        {/* Per-line status strip: what went in, what the store does not carry. */}
        {hasRecipe && phase !== 'loading' && phase !== 'links' ? (
          <View style={{ backgroundColor: t.accentSoft, paddingHorizontal: 16, paddingVertical: 8 }}>
            <View style={[s.rowStart, { gap: 8, flexWrap: 'wrap' }]}>
              <Chip text={tr('cartAdded', { n: count('added') })} tone="good" />
              {count('missing') > 0 ? <Chip text={tr('cartMissing', { n: count('missing') })} tone="warn" /> : null}
              {count('unavailable') > 0 ? <Chip text={tr('cartUnavailable', { n: count('unavailable') })} tone="warn" /> : null}
              {count('error') > 0 ? <Chip text={tr('cartError', { n: count('error') })} tone="bad" /> : null}
              {storeCount !== null && phase === 'cart' ? <Chip text={tr('storeBasket', { s: store.name, n: storeCount })} tone={storeCount >= count('added') ? 'good' : 'bad'} /> : null}
              {phase === 'filling' ? <Text style={[s.small, { color: t.accent }]}>{tr('cartWorking')}</Text> : null}
            </View>
            {storeCount !== null && phase === 'cart' && storeCount < count('added') ? <Text style={[s.small, { color: t.red, marginTop: 6 }]}>{tr('storeBasketMismatch', { s: store.name })}</Text> : null}
          </View>
        ) : null}

        {!WebView ? (
          <View style={[s.pad, { flex: 1, justifyContent: 'center' }]}>
            <Text style={[s.body, { textAlign: 'center' }]}>{tr('linkNeedsApp')}</Text>
            <Button title={tr('ok')} onPress={onClose} kind="secondary" />
          </View>
        ) : (
          <View style={{ flex: 1, overflow: 'hidden' }}>
            <WebView
              ref={(r) => { webref.current = r; }}
              source={{ uri }}
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              domStorageEnabled
              setSupportMultipleWindows={false}
              originWhitelist={['*']}
              userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
              onLoadEnd={onLoadEnd}
              onMessage={onMessage}
            />
          </View>
        )}

        <View style={[s.pad, { borderTopWidth: 1, borderColor: t.line, backgroundColor: t.card, paddingTop: 10 }]}>
          {phase === 'links' ? (
            /* The store's number moved up into the status strip, where the recipe flow keeps its
               own: one place on this screen tells you what the store holds. */
            <View style={[s.rowStart, { gap: 10 }]}>
              <View style={{ flex: 1 }}><Button title={linkIdx + 1 < linkLines.length ? tr('cartNextItem') : tr('cartToCart')} onPress={nextLink} testID="order-next" /></View>
            </View>
          ) : phase === 'cart' ? (
            <>
              <Button title={tr('cartDone')} icon="check" onPress={() => onDone(hasRecipe ? added : perItemDone)} testID="order-done" />
              <Text style={[s.faint, { textAlign: 'center', marginTop: 8 }]}>{tr('payAtStore')}</Text>
              {diag && count('added') === 0 ? <Text style={[s.faint, { marginTop: 4 }]} numberOfLines={2} selectable>{diag}</Text> : null}
            </>
          ) : (
            <Text style={[s.faint, { textAlign: 'center' }]}>{tr('linkPrivacy')}</Text>
          )}
          {store.cartUrl && phase === 'cart' ? <Pressable onPress={() => void Linking.openURL(store.cartUrl!)} hitSlop={8} style={{ alignItems: 'center', marginTop: 8 }}><Text style={s.link}>{tr('openInBrowser')}</Text></Pressable> : null}
        </View>
      </View>
    </Modal>
  );
}

/** The scrollable summary shown on the checkout screen before ordering on the phone. */
export function OrderPlan({ storeName, lines }: { storeName: string; lines: readonly CartLine[] }) {
  const s = S();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 4 }}>
      <Chip text={tr('cartPlan', { s: storeName, n: lines.length })} tone="good" />
    </ScrollView>
  );
}
