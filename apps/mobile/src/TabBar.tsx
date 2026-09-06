import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { isRTL, t as tr } from './lib/i18n';
import { t } from './ui';

export type Tab = 'home' | 'list' | 'orders' | 'me';
const TABS: { key: Tab; glyph: string; label: string }[] = [
  { key: 'home', glyph: '⌂', label: 'tabHome' },
  { key: 'list', glyph: '☰', label: 'tabList' },
  { key: 'orders', glyph: '◎', label: 'tabOrders' },
  { key: 'me', glyph: '☺', label: 'tabMe' },
];

export function TabBar({ active, onChange, badge }: { active: Tab; onChange: (t: Tab) => void; badge?: number }) {
  return (
    <View style={{ flexDirection: isRTL() ? 'row-reverse' : 'row', backgroundColor: t.card, borderTopWidth: 1, borderColor: t.line, paddingBottom: 6 }}>
      {TABS.map((tab) => {
        const on = tab.key === active;
        return (
          <Pressable key={tab.key} onPress={() => onChange(tab.key)} style={{ flex: 1, alignItems: 'center', paddingVertical: 8 }}>
            <View>
              <Text style={{ fontSize: 22, color: on ? t.accent : t.faint }}>{tab.glyph}</Text>
              {tab.key === 'list' && badge ? <View style={{ position: 'absolute', top: -4, right: -12, backgroundColor: t.accent, borderRadius: 999, minWidth: 18, height: 18, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>{badge}</Text></View> : null}
            </View>
            <Text style={{ fontSize: 11, fontWeight: on ? '700' : '500', color: on ? t.accent : t.muted, marginTop: 2 }}>{tr(tab.label)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
