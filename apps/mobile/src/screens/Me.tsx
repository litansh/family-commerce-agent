import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { Api, Household } from '../lib/api';
import { t as tr } from '../lib/i18n';
import { Button, Chip, Header, S, t } from '../ui';
import { Mark } from '../Logo';

export function MeScreen({ api, household, onSignOut }: { api: Api; household: Household; onSignOut: () => void }) {
  const s = S();
  const [code, setCode] = useState<string | null>(null);
  return (
    <View style={s.screen}>
      <Header title={tr('meTitle')} subtitle={household.name} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}>
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
          <Text style={[s.title, { marginBottom: 8 }]}>{tr('members')}</Text>
          {code ? <Text style={[s.priceBig, { textAlign: 'center', letterSpacing: 2 }]}>{code}</Text> : null}
          <Button title={tr('invite')} kind="secondary" onPress={() => api.invite(household.id).then((r) => setCode(r.code)).catch(() => null)} />
        </View>
        <Button title={tr('signOut')} kind="quiet" onPress={onSignOut} />
        <View style={{ alignItems: 'center', marginTop: 24, opacity: 0.5 }}><Mark size={28} /><Text style={[s.faint, { marginTop: 6 }]}>{tr('taglineShort')}</Text></View>
      </ScrollView>
    </View>
  );
}
