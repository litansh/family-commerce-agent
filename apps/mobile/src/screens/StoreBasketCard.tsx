import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button, Chip, PriceCol, S, t } from '../ui';
import { money, t as tr } from '../lib/i18n';
import { alternativeTo, headlineOf, type BasketLike, type BasketMode, type BasketPrice, type BasketSwap, type StoreCardFacts } from '../lib/fullBasket';

/**
 * One store, offered with a whole basket (docs/design/a-full-basket-everywhere.md).
 *
 * Nobody orders a partial basket, so this card's one decision is **buy the whole list here, or
 * somewhere else** — never "does this store have enough of my list". Coverage is a fact printed on the
 * card, not a reason the card is missing.
 *
 * Read order, and everything on the card serves it: the store and when it delivers; one headline
 * number in cash with the basket it buys named; the other basket named beside it with the difference
 * in shekels; what was swapped and what nobody has; the two actions.
 *
 * The facts come from `lib/fullBasket.ts`, where a lab can check them; this file only says them in
 * Hebrew. No number here is computed — a card shows the engine's total or it shows none.
 */

/** Long product names, one line's worth — the same cut the compare rows use. */
const short = (x: string) => (x.length > 30 ? x.slice(0, 29) + '…' : x);

/** What a basket is called, so a number never sits on a card without saying what it buys. */
function basketName(b: BasketPrice, card: StoreCardFacts): string {
  // A store that cannot fill the list has no basket to name. Calling its number "הסל שלך" would claim
  // the one thing this card exists to be honest about; it gets the only true name instead, and the
  // note beside the price says how much of the list it is ("ל־3 מתוך 4 פריטים").
  if (!card.complete) return tr('whatTheyHave');
  if (b.mode === 'cheap') return tr('cheapBasket');
  if (b.mode === 'exact') return tr('exactBasket');
  // A store that swapped nothing the family pinned is not offering them a "full basket" as opposed to
  // something else — it is offering them theirs. Saying "סל מלא" there would invent a distinction.
  return card.swaps.some((s) => s.kind === 'missing') ? tr('fullBasketTitle') : tr('yourBasket');
}

/**
 * One swap, as the family reads it: their words, an arrow, this store's product, and what that line
 * costs inside this basket. The two kinds never share a colour — an alternative is amber because the
 * family did not choose it and cannot undo it here; a cheaper pick is green because they did and can.
 */
function SwapRow({ swap }: { swap: BasketSwap }) {
  const s = S();
  const cheaper = swap.kind === 'cheaper';
  const why = cheaper
    ? tr('swapCheaperWhy', { x: money(swap.saved ?? 0) })
    : swap.nowhere ? tr('exactNowhere')
    : swap.elsewhere?.length ? tr('exactAt', { b: swap.elsewhere.map((e) => e.brand).slice(0, 2).join(' · ') })
    : tr('swapMissingWhy');
  return (
    <View style={{ paddingVertical: 6, borderTopWidth: 1, borderColor: t.line }} testID={`swap-${swap.lineId}`}>
      <View style={[s.row, { gap: 10 }]}>
        <Text style={[s.small, { flex: 1, color: t.ink }]} numberOfLines={2}>
          {swap.asked}
          <Text style={{ color: t.faint }}>{'  →  '}</Text>
          <Text style={{ color: cheaper ? t.accent : t.amber }}>{short(swap.got)}</Text>
        </Text>
        {swap.lineTotal !== undefined ? <Text style={s.priceSmall}>{money(swap.lineTotal)}</Text> : null}
      </View>
      {/* Why this line is not what they asked for. A stable testID as well as the words: a flow that
          matches long Hebrew through the XCUITest driver is a flow that goes red for reasons that are
          not the product (docs/backlog/app-designer.md). */}
      <Text style={[s.faint, { fontSize: 11, color: cheaper ? t.accent : t.amber }]} numberOfLines={2} testID="swap-why">{why}</Text>
    </View>
  );
}

export function StoreBasketCard({ card, quote, open, mode, onToggle, onMode, onBuy, nameOf }: {
  card: StoreCardFacts;
  quote: BasketLike;
  open: boolean;
  /** The basket the family asked this card to show, or null for whichever leads. */
  mode: BasketMode | null;
  onToggle: () => void;
  /** Show this basket, or (with the same mode again) go back to whichever leads. */
  onMode: (m: BasketMode | null) => void;
  onBuy: () => void;
  nameOf: (lineId: string) => string;
}) {
  const s = S();
  const head = headlineOf(card, mode);
  const alt = alternativeTo(card, head);
  const cheapened = head.mode === 'cheap';
  // A number that is not items + delivery may not read like one that is: it stays in muted ink and its
  // note says what it covers. The same rule the compare rows have always kept (promise 4).
  const comparable = head.delivered && card.complete;
  const note = [
    card.complete ? undefined : tr('ofNofM', { n: card.filled, m: card.asked }),
    head.delivered ? undefined : tr('plusDelivery'),
    head.approx ? '≈' : undefined,
  ].filter(Boolean).join(' · ') || undefined;

  // "עשה את זה זול יותר" appears only where it can be answered. Until the engine offers cheaper
  // products for a store, the card shows no button rather than one that does nothing; an empty list
  // is the engine having looked and found nothing, which is a sentence, not a dead tap.
  const cheaperList = quote.cheaper?.[card.storefrontId];
  const cheaperAnswered = cheaperList !== undefined;
  const nothingCheaper = cheaperAnswered && cheaperList.length === 0;

  const buyTitle = card.shortOfMinimum !== undefined
    ? tr('addToOrder', { x: money(card.shortOfMinimum) })
    : tr('buyHereFor', { x: head.total !== undefined ? money(head.total) : '' });

  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => [s.card, { marginBottom: 10, padding: 16 }, pressed ? { opacity: 0.85 } : null]}
      testID={`basket-${card.storefrontId}`}
    >
      {/* 1 — who, and when it comes. */}
      <View style={[s.row, { gap: 10 }]}>
        <View style={{ flex: 1 }}>
          <View style={[s.rowStart, { gap: 6, flexWrap: 'wrap' }]}>
            <Text style={[s.body, { fontSize: 15, fontWeight: '700', flexShrink: 1 }]} numberOfLines={1}>{card.brand}</Text>
            {cheapened ? <Chip text={tr('cheapChip')} tone="good" /> : null}
            {card.closed ? <Chip text={tr('etaClosed')} tone="warn" /> : null}
          </View>
          {/* 2 — the basket this number buys, named. One headline per card, and it is cash. */}
          <Text style={[s.faint, { fontSize: 12, marginTop: 2 }]} testID={`basket-${card.storefrontId}-name`}>{basketName(head, card)}</Text>
        </View>
        <PriceCol
          price={head.total !== undefined ? money(head.total) : '—'}
          {...(note ? { note } : {})}
          color={comparable ? t.ink : t.muted}
          size={20}
        />
      </View>

      {/* 3 — the other basket, named as what it actually is, with the difference in shekels. One tap
          switches the headline to it, and the same tap again comes back: "the exact basket is always
          reachable in one tap, with its own number and the difference". */}
      {alt ? (
        <Pressable
          onPress={(e) => { e.stopPropagation?.(); onMode(alt.basket.mode === head.mode ? null : alt.basket.mode); }}
          hitSlop={6}
          testID={`basket-${card.storefrontId}-alt`}
        >
          <Text style={[s.small, { marginTop: 6, color: t.accent }]}>
            {basketName(alt.basket, card)} {money(alt.basket.total ?? 0)} ({alt.diff >= 0 ? '+' : '−'}{money(Math.abs(alt.diff))})
            {/* A total that had to cross a store boundary has a second delivery inside it, and says so. */}
            {alt.basket.approx ? ` · ${tr('exactTwoStops', { b: card.swaps.flatMap((x) => x.elsewhere ?? []).map((e) => e.brand)[0] ?? '' })}` : ''}
          </Text>
        </Pressable>
      ) : null}

      {/* A minimum is a fact in shekels, not a rejection: it says exactly what would make this orderable. */}
      {card.shortOfMinimum !== undefined ? (
        <Text style={[s.small, { marginTop: 4, color: t.amber }]} testID={`basket-${card.storefrontId}-min`}>
          {tr('shortOfMin', { x: money(card.shortOfMinimum), y: money(card.minimumOrder ?? 0) })}
        </Text>
      ) : null}

      {/* The only honest gap: lines this store cannot fill even with an alternative. */}
      {!card.complete ? (
        <Text style={[s.small, { marginTop: 4, color: t.red }]} numberOfLines={2} testID={`basket-${card.storefrontId}-gap`}>
          {tr('noAlternativeFor', { x: card.unfillableLineIds.map((id) => short(nameOf(id))).slice(0, 3).join(', ') + (card.unfillableLineIds.length > 3 ? '…' : '') })}
        </Text>
      ) : null}

      {/* 4 — never a silent swap: how many, and every one of them a tap away. */}
      {card.swaps.length ? (
        <Text style={[s.small, { marginTop: 6 }]} testID={`basket-${card.storefrontId}-swaps`}>
          {open ? '▾' : '▸'} {card.swaps.length === 1 ? tr('swaps1') : tr('swapsN', { n: card.swaps.length })}
          {cheapened && card.cheap?.total !== undefined && card.full.total !== undefined
            ? ` · ${tr('savedHere', { x: money(card.full.total - card.cheap.total) })}`
            : ''}
        </Text>
      ) : null}
      {open && card.swaps.length ? (
        <View style={{ marginTop: 4 }} testID={`basket-${card.storefrontId}-open`}>
          {card.swaps.map((swap) => <SwapRow key={swap.lineId} swap={swap} />)}
        </View>
      ) : null}

      {/* 5 — the actions. A store that cannot fill the basket keeps its way to be bought from
          (promises 1 and 6: a card that names a store opens that store), but as a quiet link that says
          what it would really buy — a primary button reading "קנו כאן · ₪23.75" would offer a basket
          this store has not got. Never removed for tidiness; moved and sized. */}
      <View style={{ marginTop: 10, gap: 8 }}>
        {card.complete ? (
          <Button title={buyTitle} kind="secondary" onPress={onBuy} testID={`basket-buy-${card.storefrontId}`} />
        ) : (
          <Pressable onPress={onBuy} hitSlop={8} style={{ alignItems: 'center', paddingVertical: 6 }} testID={`basket-buy-${card.storefrontId}`}>
            <Text style={[s.link, { fontSize: 14, color: t.muted }]}>{tr('buyWhatItHas', { n: card.filled })}</Text>
          </Pressable>
        )}
        {!card.complete ? null : nothingCheaper ? (
          <Text style={[s.faint, { fontSize: 12, textAlign: 'center' }]} testID={`basket-nocheaper-${card.storefrontId}`}>{tr('cheaperNone')}</Text>
        ) : cheaperAnswered ? (
          <Pressable onPress={(e) => { e.stopPropagation?.(); onMode(cheapened ? null : 'cheap'); }} hitSlop={8} style={{ alignItems: 'center', paddingVertical: 6 }} testID={`basket-cheaper-${card.storefrontId}`}>
            <Text style={[s.link, { fontSize: 14 }]}>{cheapened ? tr('undoCheaper') : tr('makeCheaper')}</Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}
