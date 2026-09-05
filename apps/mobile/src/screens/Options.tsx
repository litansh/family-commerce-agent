import React, { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import type { PurchaseOption } from '@fca/domain';
import { ils, type Api, type Household, type QuoteResult } from '../lib/api';
import type { Line } from '../lib/store';
import { Button, Loading, Pill, c, s } from '../ui';

/**
 * The costed ways to buy the list. Cash cost is the headline; time cost is
 * shown separately when the household prices its time and is never merged.
 * Anything a storefront cannot supply is named, not hidden in a percentage.
 */
export function OptionsScreen({ api, household, lines, onBack, onChoose }: {
  api: Api; household: Household; lines: Line[]; onBack: () => void; onChoose: (opt: PurchaseOption, q: QuoteResult) => void;
}) {
  const [q, setQ] = useState<QuoteResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.quote(household.id, lines.map(({ id: _i, ...l }) => l)).then(setQ).catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, [api, household.id, lines]);

  if (err) return <View style={[s.screen, s.pad]}><Text style={[s.p, { color: c.danger }]}>{err}</Text><Button title="חזרה" onPress={onBack} ghost /></View>;
  if (!q) return <View style={s.screen}><Loading label="משווים בין כל הרשתות שמגיעות אליכם… (~20 שניות)" /></View>;

  const best = q.options[0];
  const nameOf = (id: string) => q.lines.find((l) => l.id === id)?.query ?? id;
  const letters = 'אבגדה';

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Pressable onPress={onBack}><Text style={[s.muted, { color: c.accent, marginBottom: 8 }]}>‹ חזרה לרשימה</Text></Pressable>
      <Text style={s.h1}>איך לקנות?</Text>
      <Text style={[s.muted, { marginBottom: 12 }]}>{q.fromMemory.length} פריטים זוהו מהזיכרון המשפחתי · {q.lines.length} פריטים</Text>

      {q.options.length === 0 && <View style={s.card}><Text style={s.p}>אף חנות לא מצליחה לספק מספיק מהרשימה. נסו לפצל או לשנות פריטים.</Text></View>}

      {q.options.map((o, i) => {
        const saving = best && o !== best ? best.cashCost - o.cashCost : 0;
        return (
          <Pressable key={i} onPress={() => onChoose(o, q)} style={[s.card, i === 0 && { borderColor: c.accent, borderWidth: 2 }]}>
            <View style={s.row}>
              <Text style={s.h2}>אפשרות {letters[i]} — {o.label}</Text>
              <Text style={[s.h2, { color: c.accent }]}>{ils(o.cashCost)}</Text>
            </View>
            {o.legs.map((leg) => (
              <Text key={leg.storefrontId} style={s.muted}>{leg.brand}: מוצרים {ils(leg.itemsSubtotal)} + משלוח {ils(leg.deliveryFee)} ({leg.lineIds.length} פריטים)</Text>
            ))}
            {o.timeCost > 0 && <Text style={s.muted}>זמן (בנפרד): {ils(o.timeCost)}</Text>}
            {saving < 0 && <Text style={[s.muted, { color: c.warn }]}>יקר ב-{ils(-saving)} מאפשרות א</Text>}
            {o.unpricedLineIds.length > 0 && <Text style={[s.muted, { color: c.danger }]}>⚠ לא זמין: {o.unpricedLineIds.map(nameOf).join(', ')}</Text>}
            <View style={{ flexDirection: 'row-reverse', gap: 6, flexWrap: 'wrap' }}>
              <Pill text={`כיסוי ${Math.round(o.coverageRatio * 100)}%`} />
              {o.substitutedLineCount > 0 && <Pill text={`${o.substitutedLineCount} תחליפים`} color={c.warn} />}
            </View>
            <Text style={[s.muted, { marginTop: 6 }]}>{o.explanation.reason}</Text>
          </Pressable>
        );
      })}

      {q.warnings.length > 0 && (
        <View style={[s.card, { borderColor: c.warn }]}>
          <Text style={[s.h2, { color: c.warn }]}>כדאי לאשר ברקוד</Text>
          <Text style={s.muted}>פריטים שהמחיר שלהם משתנה מאוד בין רשתות — כנראה זוהו כמוצרים שונים.</Text>
          {q.warnings.map((w, i) => <Text key={i} style={s.muted}>• {w.split(' varies')[0]?.replace('Line ', '')}</Text>)}
        </View>
      )}

      {q.rejected.length > 0 && (
        <View style={s.card}>
          <Text style={s.h2}>לא הוצעו</Text>
          {q.rejected.map((r, i) => <Text key={i} style={s.muted}>{r.brand} — {r.reason}</Text>)}
        </View>
      )}
    </ScrollView>
  );
}

/** After choosing: deep links per item, and a "done" that teaches memory. */
export function CheckoutScreen({ api, household, option, quote, onDone, onBack }: {
  api: Api; household: Household; option: PurchaseOption; quote: QuoteResult; onDone: () => void; onBack: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const nameOf = (id: string) => quote.lines.find((l) => l.id === id);
  const done = async () => {
    setBusy(true);
    const bought = option.legs.flatMap((leg) => leg.lineIds).flatMap((id) => {
      const l = nameOf(id); const ql = quote.quotedLines[id];
      if (!l || !ql?.gtin) return [];
      return [{ phrase: l.query, gtin: ql.gtin, productName: ql.productName, ...(l.brand ? { brand: l.brand } : {}), ...(l.amount !== undefined && l.unit ? { amount: l.amount, unit: l.unit } : {}), ...(l.packQty !== undefined ? { packQty: l.packQty } : {}) }];
    });
    try { await api.recordShop(household.id, bought); onDone(); } finally { setBusy(false); }
  };
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Pressable onPress={onBack}><Text style={[s.muted, { color: c.accent, marginBottom: 8 }]}>‹ חזרה</Text></Pressable>
      <Text style={s.h1}>{option.label}</Text>
      <Text style={[s.p, { marginBottom: 12 }]}>סה"כ {ils(option.cashCost)}. התשלום נעשה אצל הרשת — אנחנו מכינים, אתם מאשרים.</Text>
      {option.legs.map((leg) => (
        <View key={leg.storefrontId} style={s.card}>
          <Text style={s.h2}>{leg.brand} · {ils(leg.itemsSubtotal)}</Text>
          {leg.lineIds.map((id) => {
            const l = nameOf(id); const ql = quote.quotedLines[id];
            return (
              <Pressable key={id} onPress={() => ql?.link && Linking.openURL(ql.link)} style={[s.row, { paddingVertical: 8, borderTopWidth: 1, borderColor: c.line }]}>
                <View style={{ flex: 1 }}>
                  <Text style={s.p}>{l?.query}</Text>
                  <Text style={s.muted}>{ql?.productName ?? ''}</Text>
                </View>
                {ql?.link ? <Text style={{ color: c.accent }}>פתח ›</Text> : null}
              </Pressable>
            );
          })}
        </View>
      ))}
      <Button title="סיימתי לקנות — תזכרו את זה" onPress={done} disabled={busy} />
      <Text style={[s.muted, { marginTop: 8 }]}>הזיכרון לומד רק מקנייה שהושלמה. קנייה שנזנחה לא משנה דבר.</Text>
    </ScrollView>
  );
}
