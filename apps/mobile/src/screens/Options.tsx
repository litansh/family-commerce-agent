import React, { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import type { PurchaseOption } from '@fca/domain';
import { ils, type Api, type Household, type QuoteResult } from '../lib/api';
import type { Line } from '../lib/store';
import { Button, Chip, Header, Loading, Rank, s, t } from '../ui';
import { reasonHe, rejectionHe } from '../lib/he';

const LETTERS = 'אבגדה';

/**
 * The costed ways to buy the list. Cash is the headline; time cost is shown
 * separately and never merged. Anything a storefront cannot supply is named.
 */
export function OptionsScreen({ api, household, lines, onBack, onChoose }: {
  api: Api; household: Household; lines: Line[]; onBack: () => void; onChoose: (opt: PurchaseOption, q: QuoteResult) => void;
}) {
  const [q, setQ] = useState<QuoteResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.quote(household.id, lines.map(({ id: _i, ...l }) => l)).then(setQ).catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, [api, household.id, lines]);

  if (err) return <View style={s.screen}><Header title="משהו השתבש" onBack={onBack} /><Text style={[s.body, s.pad, { color: t.red }]}>{err}</Text></View>;
  if (!q) return <View style={s.screen}><Header title="משווים…" subtitle={`${lines.length} פריטים בכל הרשתות שמגיעות ל${household.address}`} onBack={onBack} /><Loading label="בערך 20 שניות" /></View>;

  const best = q.options[0];
  const nameOf = (id: string) => q.lines.find((l) => l.id === id)?.query ?? id;
  const spread = q.options.length > 1 ? q.options[q.options.length - 1]!.cashCost - best!.cashCost : 0;

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingBottom: 32 }}>
      <Header title="איך לקנות?" subtitle={`${q.lines.length} פריטים · ${q.fromMemory.length} זוהו מהזיכרון המשפחתי${spread > 0 ? ` · פער של ${ils(spread)} בין הרשתות` : ''}`} onBack={onBack} />
      <View style={{ paddingHorizontal: 20 }}>
        {q.options.length === 0 && <View style={s.card}><Text style={s.body}>אף רשת לא מצליחה לספק מספיק מהרשימה. נסו לשנות פריטים.</Text></View>}

        {q.options.map((o, i) => {
          const isBest = i === 0;
          const extra = best && !isBest ? o.cashCost - best.cashCost : 0;
          return (
            <Pressable key={i} onPress={() => onChoose(o, q)} style={({ pressed }) => [s.card, isBest && { borderWidth: 2, borderColor: t.accent }, pressed && { opacity: 0.85 }]}>
              <View style={s.row}>
                <View style={[s.rowStart, { flex: 1 }]}>
                  <Rank letter={LETTERS[i] ?? '?'} best={isBest} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.title, { fontSize: 18 }]} numberOfLines={1}>{o.label}</Text>
                    <Text style={s.small}>{reasonHe(o.explanation.reason)}</Text>
                  </View>
                </View>
              </View>
              <View style={[s.row, { marginTop: 12, alignItems: 'flex-end' }]}>
                <Text style={s.priceBig}>{ils(o.cashCost)}</Text>
                {isBest ? <Chip text="הכי משתלם" tone="good" /> : extra > 0 ? <Text style={[s.small, { color: t.amber }]}>+{ils(extra)}</Text> : null}
              </View>
              <View style={s.hair} />
              {o.legs.map((leg) => (
                <View key={leg.storefrontId} style={[s.row, { paddingVertical: 3 }]}>
                  <Text style={s.small}>{leg.brand} · {leg.lineIds.length} פריטים</Text>
                  <Text style={s.priceSmall}>{ils(leg.itemsSubtotal)} + {ils(leg.deliveryFee)} משלוח</Text>
                </View>
              ))}
              {o.timeCost > 0 && <View style={[s.row, { paddingVertical: 3 }]}><Text style={s.small}>זמן (מוצג בנפרד)</Text><Text style={s.priceSmall}>{ils(o.timeCost)}</Text></View>}
              {o.unpricedLineIds.length > 0 && <Text style={[s.small, { color: t.red, marginTop: 8 }]}>לא זמין: {o.unpricedLineIds.map(nameOf).join(', ')}</Text>}
              <View style={[s.rowStart, { marginTop: 10 }]}>
                <Chip text={`כיסוי ${Math.round(o.coverageRatio * 100)}%`} tone={o.coverageRatio >= 0.99 ? 'good' : 'neutral'} />
                {o.substitutedLineCount > 0 && <Chip text={`${o.substitutedLineCount} תחליפים`} tone="warn" />}
              </View>
            </Pressable>
          );
        })}

        {q.warnings.length > 0 && (
          <View style={[s.card, { backgroundColor: t.amberSoft }]}>
            <Text style={[s.title, { color: t.amber, fontSize: 17 }]}>כדאי לאשר פעם אחת</Text>
            <Text style={[s.small, { color: t.amber, marginBottom: 6 }]}>המחיר של הפריטים האלה משתנה מאוד בין רשתות — כנראה זוהו כמוצרים שונים. אישור ברקוד אחד מתקן את זה לתמיד.</Text>
            {q.warnings.map((w, i) => <Text key={i} style={[s.body, { color: t.amber }]}>• {/"([^"]+)"/.exec(w)?.[1] ?? w}</Text>)}
          </View>
        )}

        {q.rejected.length > 0 && (
          <View style={{ marginTop: 4 }}>
            <Text style={[s.small, { marginBottom: 4 }]}>לא הוצעו — לא מספקות מספיק מהרשימה</Text>
            {q.rejected.map((r, i) => <Text key={i} style={s.faint}>{r.brand} · {rejectionHe(r.reason)}</Text>)}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

/** After choosing: deep links per item, and a "done" that teaches memory. */
export function CheckoutScreen({ api, household, option, quote, onDone, onBack }: {
  api: Api; household: Household; option: PurchaseOption; quote: QuoteResult; onDone: () => void; onBack: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const lineOf = (id: string) => quote.lines.find((l) => l.id === id);
  const done = async () => {
    setBusy(true);
    const bought = option.legs.flatMap((leg) => leg.lineIds).flatMap((id) => {
      const l = lineOf(id); const ql = quote.quotedLines[id];
      if (!l || !ql?.gtin) return [];
      return [{ phrase: l.query, gtin: ql.gtin, productName: ql.productName, ...(l.brand ? { brand: l.brand } : {}), ...(l.amount !== undefined && l.unit ? { amount: l.amount, unit: l.unit } : {}), ...(l.packQty !== undefined ? { packQty: l.packQty } : {}) }];
    });
    try { await api.recordShop(household.id, bought); onDone(); } finally { setBusy(false); }
  };
  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingBottom: 32 }}>
      <Header title={option.label} subtitle="התשלום נעשה באתר הרשת. אנחנו מכינים — אתם מאשרים." onBack={onBack} />
      <View style={{ paddingHorizontal: 20 }}>
        <View style={[s.row, { marginBottom: 12 }]}><Text style={s.small}>סה״כ משוער</Text><Text style={s.priceBig}>{ils(option.cashCost)}</Text></View>
        {option.legs.map((leg) => (
          <View key={leg.storefrontId} style={s.card}>
            <View style={s.row}><Text style={s.title}>{leg.brand}</Text><Text style={s.price}>{ils(leg.itemsSubtotal)}</Text></View>
            {leg.lineIds.map((id, i) => {
              const l = lineOf(id); const ql = quote.quotedLines[id];
              return (
                <Pressable key={id} onPress={() => ql?.link && Linking.openURL(ql.link)} style={[s.row, { paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderColor: t.line, marginTop: i === 0 ? 8 : 0 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.body}>{l?.query}</Text>
                    <Text style={s.small} numberOfLines={1}>{ql?.productName ?? ''}</Text>
                  </View>
                  {ql?.link ? <Text style={s.link}>פתח ›</Text> : null}
                </Pressable>
              );
            })}
          </View>
        ))}
        <Button title="סיימתי — תזכרו את הקנייה הזו" onPress={done} disabled={busy} />
        <Text style={[s.small, { marginTop: 10, textAlign: 'center' }]}>הזיכרון לומד רק מקנייה שהושלמה.</Text>
      </View>
    </ScrollView>
  );
}
