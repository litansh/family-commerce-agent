import React, { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { Api, Household } from '../lib/api';
import { t as tr } from '../lib/i18n';
import { Button, Chip, Header, LanguagePicker, S, t } from '../ui';
import { useLanguage } from '../lib/i18n';
import { STORES } from '../lib/stores';
import { useLinked, markLinked, markUnlinked } from '../lib/linked';
import { StoreLink } from './StoreLink';
import { Mark } from '../Logo';

export function MeScreen({ api, household, onSignOut, onShowIntro }: { api: Api; household: Household; onSignOut: () => void; onShowIntro: () => void }) {
  const s = S();
  useLanguage();
  const linked = useLinked();
  const [linking, setLinking] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [worker, setWorker] = useState<{ online: boolean; linked: Record<string, boolean> } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => { const tick = () => api.worker(household.id).then(setWorker).catch(() => null); tick(); const h = setInterval(tick, 15000); return () => clearInterval(h); }, [api, household.id]);
  const cmd = (r: string) => `cd ~/GolandProjects/family-commerce-agent && source ~/.kanili/env && KANILI_HOUSEHOLD=${household.id} KANILI_RETAILER=${r} npm run link -w @fca/order-worker`;
  const copy = async (r: string) => { const c = cmd(r); if (Platform.OS === 'web') await navigator.clipboard?.writeText(c); else await Clipboard.setStringAsync(c); setCopied(r); setTimeout(() => setCopied(null), 1500); };
  return (
    <View style={s.screen}>
      <Header title={tr('meTitle')} subtitle={household.name} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}>
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
          {(household.retailers ?? ['shufersal']).map((r) => {
            const on = linked.includes(r);
            return (
              <View key={r} style={[s.row, { paddingVertical: 10, borderTopWidth: 1, borderColor: t.line }]}>
                <View style={s.rowStart}><Text style={s.body}>{STORES[r]?.name ?? r}</Text><Chip text={on ? tr('linked', {}) : tr('notLinked')} tone={on ? 'good' : 'warn'} /></View>
                {on
                  ? <Pressable onPress={() => markUnlinked(r)} hitSlop={8}><Text style={[s.link, { color: t.muted }]}>{tr('disconnect')}</Text></Pressable>
                  : <Pressable onPress={() => setLinking(r)} hitSlop={8}><Text style={s.link}>{tr('connect')}</Text></Pressable>}
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
        {linking ? <StoreLink storeId={linking} api={api} householdId={household.id} onClose={() => setLinking(null)} onLinked={(id) => { markLinked(id); setLinking(null); }} /> : null}
        <View style={{ alignItems: 'center', marginTop: 24, opacity: 0.5 }}><Mark size={28} /><Text style={[s.faint, { marginTop: 6 }]}>{tr('taglineShort')}</Text></View>
      </ScrollView>
    </View>
  );
}
