import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import type { Suggestion } from '@fca/domain';
import type { Api, Household } from '../lib/api';
import { loadList, newId, saveList, type Line } from '../lib/store';
import { Button, Input, Pill, c, s } from '../ui';

/**
 * The shared list. Brand is optional per line and is honoured when given:
 * "חלב 3%" with brand "תנובה" gets Tnuva, compared, with rivals shown.
 *
 * The forgetting check runs whenever the list changes and shows what the
 * household usually buys that is not on it.
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
    const t = q.trim();
    if (!t) return;
    setLines((xs) => [...xs, { id: newId(), query: t, ...(b?.trim() ? { brand: b.trim() } : {}) }]);
    setQuery(''); setBrand('');
  };
  const remove = (id: string) => setLines((xs) => xs.filter((x) => x.id !== id));

  return (
    <View style={s.screen}>
      <View style={s.pad}>
        <View style={s.row}>
          <Text style={s.h1}>{household.name}</Text>
          <Pressable onPress={onInvite}><Text style={[s.muted, { color: c.accent }]}>הזמן בן משפחה</Text></Pressable>
        </View>
        <Text style={s.muted}>{household.address}</Text>
      </View>

      {suggestions.length > 0 && (
        <View style={[s.card, { marginHorizontal: 16, borderColor: c.warn }]}>
          <Text style={[s.h2, { color: c.warn }]}>שכחתם משהו?</Text>
          {suggestions.slice(0, 5).map((sg) => (
            <Pressable key={sg.preference.key} onPress={() => add(sg.preference.phrase, sg.preference.brand)} style={[s.row, { paddingVertical: 6 }]}>
              <Text style={s.p}>{sg.preference.phrase}</Text>
              <Text style={s.muted}>
                {sg.reason === 'overdue' ? `כל ~${sg.usualIntervalDays} ימים · לפני ${sg.daysSince}` : `נקנה ${sg.preference.orderCount}×`}  +
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <FlatList
        data={lines}
        keyExtractor={(l) => l.id}
        contentContainerStyle={{ paddingHorizontal: 16 }}
        ListEmptyComponent={<Text style={[s.muted, { textAlign: 'center', marginTop: 20 }]}>הרשימה ריקה. הוסיפו פריטים למטה.</Text>}
        renderItem={({ item }) => (
          <View style={[s.card, s.row]}>
            <View style={{ flex: 1 }}>
              <Text style={s.p}>{item.query}</Text>
              {item.brand ? <Pill text={item.brand} /> : null}
            </View>
            <Pressable onPress={() => remove(item.id)} hitSlop={10}><Text style={{ color: c.danger, fontSize: 18 }}>✕</Text></Pressable>
          </View>
        )}
      />

      <View style={[s.pad, { borderTopWidth: 1, borderColor: c.line, backgroundColor: c.card }]}>
        <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
          <Input placeholder="מה צריך? (חלב 3%, פמפרס מידה 4…)" value={query} onChangeText={setQuery} onSubmitEditing={() => add(query, brand)} style={{ flex: 2 }} returnKeyType="done" />
          <Input placeholder="מותג (אופציונלי)" value={brand} onChangeText={setBrand} style={{ flex: 1 }} />
        </View>
        <Button title="הוסף" onPress={() => add(query, brand)} ghost disabled={!query.trim()} />
        <Button title={`השווה ${lines.length} פריטים`} onPress={() => onQuote(lines)} disabled={lines.length === 0} />
      </View>
    </View>
  );
}
