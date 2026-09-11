import React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { isRTL, t as tr } from './lib/i18n';
import { Icon, t, type IconName } from './ui';

export type Tab = 'home' | 'list' | 'orders' | 'me';
const TABS: { key: Tab; icon: IconName; label: string }[] = [
  { key: 'home', icon: 'home', label: 'tabHome' },
  { key: 'list', icon: 'basket', label: 'tabList' },
  { key: 'orders', icon: 'receipt', label: 'tabOrders' },
  { key: 'me', icon: 'user', label: 'tabMe' },
];

/**
 * A quiet floating bar: white, hairline edge, soft shadow. The active tab is
 * ink with its label under it and a small green dot — a mark, not a blob.
 */
export function TabBar({ active, onChange, badge, ordersBadge }: { active: Tab; onChange: (t: Tab) => void; badge?: number; ordersBadge?: number }) {
  const bar = Platform.select({
    ios: { shadowColor: '#0E1512', shadowOpacity: 0.10, shadowRadius: 22, shadowOffset: { width: 0, height: 8 } },
    android: { elevation: 10 },
    default: { boxShadow: '0 8px 28px rgba(14,21,18,0.12)' },
  }) as object;
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingBottom: Platform.OS === 'web' ? 16 : 6 }} pointerEvents="box-none">
      <View style={[{ flexDirection: isRTL() ? 'row-reverse' : 'row', backgroundColor: t.card, borderRadius: 28, paddingVertical: 8, paddingHorizontal: 6, borderWidth: 1, borderColor: t.line }, bar]}>
        {TABS.map((tab) => {
          const on = tab.key === active;
          return (
            <Pressable key={tab.key} onPress={() => onChange(tab.key)} hitSlop={6} style={({ pressed }) => [{ flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 20 }, pressed && { opacity: 0.5 }]}>
              <View>
                <Icon name={tab.icon} size={22} color={on ? t.ink : t.faint} />
                {(tab.key === 'list' && badge) || (tab.key === 'orders' && ordersBadge) ? (
                  <View style={{ position: 'absolute', top: -6, right: -10, backgroundColor: t.accent, borderRadius: 999, minWidth: 17, height: 17, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: t.card }}>
                    <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{tab.key === 'list' ? badge : ordersBadge}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={{ color: on ? t.ink : t.faint, fontWeight: on ? '700' : '500', fontSize: 11, marginTop: 4, letterSpacing: -0.1 }}>{tr(tab.label)}</Text>
              <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: on ? t.accent2 : 'transparent', marginTop: 3 }} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
