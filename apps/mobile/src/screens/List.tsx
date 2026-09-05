import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import type { Suggestion } from '@fca/domain';
import type { Api, Household } from '../lib/api';
import { loadList, newId, saveList, type Line } from '../lib/store';
import { Button, Chip, Empty, Header, Input, s, t } from '../ui';

/**
 * The shared list. A brand on a line is honoured when given: "חלב 3%" with
 * brand "תנובה" gets Tnuva, compared, with rivals shown. The forgetting
 * check runs whenever the list changes.
 */
export function ListScreen({ api, household, onQuote, onInvite }: {
  api: Api; household: Household; onQuote: (lines: Line[]) => void; onInvite: () => void;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [query, setQuery] = useState('');
  const [brand, setBrand] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  useEffect(() => { void loadList().then(setLines); }, []);
  useEffect(() => {
    void saveList(lines);
    api.suggest(household.id, lines.map(({ id: _i, ...l }) => l)).then((r) => setSuggestions(r.suggestions)).catch(() => setSuggestions([]));
  }, [lines, api, household.id]);

  const add = (q: string, b?: string) => {
    const txt = q.trim();
    if (!txt) return;
    setLines((xs) => [...xs, { id: newId(), query: txt, ...(b?.trim() ? { brand: b.trim() } : {}) }]);
    setQuery(''); setBrand('');
  };
  const remove = (id: string) => setLines((xs) => xs.filter((x) => x.id !== id));

  return (
    <View style={s.screen}>
      <Header title={household.name} subtitle={household.address} action="הזמנת בן משפחה" onAction={onInvite} />

      <FlatList
        data={lines}
        keyExtractor={(l) => l.id}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }}
        ListHeaderComponent={
          suggestions.length > 0 ? (
            <View style={[s.card, { backgroundColor: t.amberSoft, marginBottom: 16 }]}>
              <Text style={[s.title, { color: t.amber, fontSize: 17 }]}>שכחתם משהו?</Text>
              <Text style={[s.small, { color: t.amber, marginBottom: 6 }]}>דברים שאתם קונים בדרך כלל ולא ברשימה. הקישו להוספה.</Text>
              {suggestions.slice(0, 5).map((sg) => (
                <Pressable key={sg.preference.key} onPress={() => add(sg.preference.phrase, sg.preference.brand)} style={[s.row, { paddingVertical: 9, borderTopWidth: 1, borderColor: '#EFDDB6' }]}>
                  <Text style={s.body}>{sg.preference.phrase}</Text>
                  <Text style={[s.small, { color: t.amber }]}>
                    {sg.reason === 'overdue' ? `כל ~${sg.usualIntervalDays} ימים · לפני ${sg.daysSince}` : `נקנה ${sg.preference.orderCount}×`}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null
        }
        ListEmptyComponent={<Empty title="הרשימה ריקה" hint="כתבו מה צריך — למשל ״חלב 3%״ או ״פמפרס מידה 4״. אפשר לציין מותג אם זה חשוב." />}
        renderItem={({ item, index }) => (
          <View style={[s.row, { paddingVertical: 13, borderTopWidth: index === 0 ? 0 : 1, borderColor: t.line }]}>
            <View style={[s.rowStart, { flex: 1 }]}>
              <Text style={[s.body, { fontSize: 17 }]}>{item.query}</Text>
              {item.brand ? <Chip text={item.brand} tone="good" /> : null}
            </View>
            <Pressable onPress={() => remove(item.id)} hitSlop={12}><Text style={{ color: t.faint, fontSize: 20 }}>✕</Text></Pressable>
          </View>
        )}
      />

      <View style={{ padding: 16, paddingBottom: 20, backgroundColor: t.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 16, shadowOffset: { width: 0, height: -4 } }}>
        <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
          <Input placeholder="מה צריך?" value={query} onChangeText={setQuery} onSubmitEditing={() => add(query, brand)} style={{ flex: 2, backgroundColor: t.bg, borderWidth: 0 }} returnKeyType="done" />
          <Input placeholder="מותג" value={brand} onChangeText={setBrand} onSubmitEditing={() => add(query, brand)} style={{ flex: 1, backgroundColor: t.bg, borderWidth: 0 }} />
        </View>
        <View style={{ height: 10 }} />
        {query.trim() ? (
          <Button title={`הוסף ${query.trim()}`} kind="secondary" onPress={() => add(query, brand)} />
        ) : (
          <Button title={lines.length === 0 ? 'השוואת מחירים' : `השוו ${lines.length} פריטים בכל הרשתות`} onPress={() => onQuote(lines)} disabled={lines.length === 0} />
        )}
      </View>
    </View>
  );
}
