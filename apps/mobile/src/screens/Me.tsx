import React, { useEffect, useState } from 'react';
import { Linking, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { Api, Household } from '../lib/api';
import { t as tr } from '../lib/i18n';
import { Button, Chip, Header, LanguagePicker, S, t } from '../ui';
import { useLanguage } from '../lib/i18n';
import { STORE_ORDER, STORES } from '../lib/stores';
import { useLinked, useRelink, markLinked, markUnlinked } from '../lib/linked';
import { StoreLink } from './StoreLink';
import { Mark } from '../Logo';
import { BUILD } from '../lib/config';

export function MeScreen({ api, household, onSignOut, onShowIntro }: { api: Api; household: Household; onSignOut: () => void; onShowIntro: () => void }) {
  const s = S();
  useLanguage();
  const local = useLinked();
  const relink = useRelink();
  // The cloud's answer is the family's answer: a store connected on one phone
  // is connected on every device. The device flag is a cache of it.
  const [cloud, setCloud] = useState<Record<string, { connected: boolean; method?: string }>>({});
  const refreshCloud = () => api.connections(household.id).then((r) => setCloud(r.connections)).catch(() => null);
  useEffect(() => { void refreshCloud(); }, [api, household.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const linked = [...new Set([...local, ...Object.entries(cloud).filter(([, c]) => c.connected).map(([id]) => id)])];
  const [linking, setLinking] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [worker, setWorker] = useState<{ online: boolean; linked: Record<string, boolean> } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // Only stores that actually deliver here. Until the answer arrives (or if it
  // fails), show everything rather than nothing.
  const [nearby, setNearby] = useState<string[] | null>(null);
  useEffect(() => {
    api.stores(household.id).then((r) => {
      const hay = r.storefronts.map((x) => `${x.serviceSlug} ${x.brand} ${x.chainName}`);
      setNearby(STORE_ORDER.filter((id) => hay.some((h) => STORES[id]!.storefront.test(h))));
    }).catch(() => setNearby(null));
  }, [api, household.id]);
  const storeIds = nearby && nearby.length > 0 ? [...new Set([...nearby, ...linked])] : STORE_ORDER;
  useEffect(() => { const tick = () => api.worker(household.id).then(setWorker).catch(() => null); tick(); const h = setInterval(tick, 15000); return () => clearInterval(h); }, [api, household.id]);
  const cmd = (r: string) => `cd ~/GolandProjects/family-commerce-agent && source ~/.kaniti/env && KANITI_HOUSEHOLD=${household.id} KANITI_RETAILER=${r} npm run link -w @fca/order-worker`;
  const copy = async (r: string) => { const c = cmd(r); if (Platform.OS === 'web') await navigator.clipboard?.writeText(c); else await Clipboard.setStringAsync(c); setCopied(r); setTimeout(() => setCopied(null), 1500); };
  return (
    <View style={s.screen}>
      <Header title={tr('meTitle')} subtitle={`${household.name} · build ${BUILD}`} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}>
        <View style={[s.card, s.row]}><Text style={s.title}>{tr('language')}</Text><LanguagePicker /></View>
        <View style={s.card}>
          <Text style={s.small}>{household.address}</Text>
          <Text style={[s.faint, { marginTop: 4 }]}>ID {household.id}</Text>
        </View>
        <View style={s.card}>
          <Text style={[s.title, { marginBottom: 8 }]}>{tr('yourStores')}</Text>
          <View style={[s.rowStart, { flexWrap: 'wrap' }]}>{(household.retailers ?? []).map((r) => <Chip key={r} text={r} tone="good" />)}</View>
          <Text style={[s.small, { marginTop: 10 }]}>{tr('getIt')}: {household.fulfillment ? tr(`${household.fulfillment}_`) : '—'}</Text>
        </View>
        <View style={s.card}>
          <Text style={[s.title, { marginBottom: 4 }]}>{tr('connectedStores')}</Text>
          <Text style={[s.small, { marginBottom: 8 }]}>{tr('connectedStoresSub')}</Text>
          {/* Every store Kaniti can order from - not only the ones picked at setup. */}
          {storeIds.map((r) => {
            const on = linked.includes(r);
            const lapsed = on && relink.includes(r);
            const otp = STORES[r]?.loginKind === 'otp';
            // On the web, a store with no cloud rung connects on the phone; say so up front.
            const badge = lapsed ? tr('relinkBadge') : on ? tr('linked', {}) : Platform.OS === 'web' ? (STORES[r]?.cloud ? tr('cloudBadge') : tr('phoneBadge')) : otp ? tr('otpBadge') : tr('pwBadge');
            return (
              <View key={r} testID={`store-row-${r}`} style={[s.row, { paddingVertical: 10, borderTopWidth: 1, borderColor: t.line }]}>
                <View style={[s.rowStart, { flexShrink: 1, flexWrap: 'wrap' }]}>
                  <Text style={s.body} numberOfLines={1}>{STORES[r]?.name ?? r}</Text>
                  <Chip text={badge} tone={lapsed ? 'warn' : on ? 'good' : otp || STORES[r]?.cloud ? 'good' : 'neutral'} />
                  {lapsed ? <Text style={[s.small, { color: t.amber, width: '100%' }]}>{tr(otp ? 'relinkWhyOtp' : 'relinkWhyPw', { s: STORES[r]?.name ?? r })}</Text> : null}
                </View>
                {lapsed
                  ? <Pressable onPress={() => setLinking(r)} hitSlop={8} testID={`relink-${r}`}><Text style={[s.link, { color: t.amber }]}>{tr('relinkNow')}</Text></Pressable>
                  : on
                  ? <View style={[s.rowStart, { gap: 14 }]}>
                      <Pressable onPress={() => setLinking(r)} hitSlop={8}><Text style={s.link}>{tr('sync')}</Text></Pressable>
                      <Pressable onPress={() => { markUnlinked(r); void api.disconnectStore(household.id, r).then(refreshCloud).catch(() => null); }} hitSlop={8}><Text style={[s.link, { color: t.muted }]}>{tr('disconnect')}</Text></Pressable>
                    </View>
                  : <Pressable onPress={() => setLinking(r)} hitSlop={8} testID={`connect-${r}`}><Text style={s.link}>{tr('connect')}</Text></Pressable>}
              </View>
            );
          })}
        </View>
        <View style={s.card}>
          <Text style={[s.title, { marginBottom: 8 }]}>{tr('members')}</Text>
          {code ? <Text style={[s.priceBig, { textAlign: 'center', letterSpacing: 2 }]}>{code}</Text> : null}
          <Button title={tr('invite')} kind="secondary" onPress={() => api.invite(household.id).then((r) => setCode(r.code)).catch(() => null)} />
        </View>
        <Button title={tr('showIntro')} kind="quiet" onPress={onShowIntro} />
        <Button title={tr('signOut')} kind="quiet" onPress={onSignOut} />
        {/* Reachable from inside the app, which Apple requires and anyone wondering what we keep deserves. */}
        <Pressable onPress={() => void Linking.openURL('https://d3lykvs28o7qrc.cloudfront.net/privacy.html')} hitSlop={8} style={{ alignItems: 'center', paddingVertical: 10 }}>
          <Text style={[s.small, { color: t.muted, textDecorationLine: 'underline' }]}>{tr('privacy')}</Text>
        </Pressable>
        {/* Deleting is a person's right and must be reachable without asking anyone, but never by one
            stray tap: the sheet says exactly what goes, and only then does anything happen. */}
        <Pressable onPress={() => setAsking(true)} hitSlop={8} style={{ alignItems: 'center', paddingVertical: 14 }}>
          <Text style={[s.small, { color: t.red }]}>{tr('deleteAccount')}</Text>
        </Pressable>
        <Modal transparent animationType="fade" visible={asking} onRequestClose={() => setAsking(false)}>
          <Pressable style={{ flex: 1, backgroundColor: '#0007' }} onPress={() => setAsking(false)} />
          <View style={{ backgroundColor: t.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 34 }}>
            <Text style={[s.title, { fontSize: 18 }]}>{tr('deleteAccountAsk')}</Text>
            <Text style={[s.body, { marginTop: 10 }]}>{tr('deleteAccountWhat')}</Text>
            <View style={{ marginTop: 20, gap: 10 }}>
              <Button title={tr('keepIt')} onPress={() => setAsking(false)} />
              <Pressable
                disabled={deleting}
                onPress={() => { setDeleting(true); api.deleteHousehold(household.id).then(onSignOut).catch(() => { setDeleting(false); setAsking(false); }); }}
                style={{ alignItems: 'center', paddingVertical: 12 }}
              >
                <Text style={{ color: t.red, fontWeight: '700' }}>{deleting ? tr('deletingAccount') : tr('deleteAccountGo')}</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
        {linking ? <StoreLink storeId={linking} api={api} householdId={household.id} onClose={() => { setLinking(null); void refreshCloud(); }} onLinked={(id) => { markLinked(id); setLinking(null); void refreshCloud(); }} /> : null}
        <View style={{ alignItems: 'center', marginTop: 24, opacity: 0.5 }}><Mark size={28} /><Text style={[s.faint, { marginTop: 6 }]}>{tr('taglineShort')}</Text><Text style={[s.faint, { marginTop: 4, fontSize: 10 }]}>build {BUILD}</Text></View>
      </ScrollView>
    </View>
  );
}
