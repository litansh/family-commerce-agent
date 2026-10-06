/**
 * Turning a set of catalogue candidates into a choice the family controls.
 *
 * Two rules, both deterministic:
 *
 *  1. **A named brand is honoured.** If the family said "תנובה", the chosen
 *     product is Tnuva. We never quietly swap in a cheaper brand — that is the
 *     difference between an assistant and a shop that substitutes on you.
 *  2. **Alternatives are always offered.** Including the cheaper other-brand
 *     equivalent the family did not ask for, ranked by price per 100ml/100g,
 *     because a 1L bag and a 2L carton are not comparable on sticker price.
 */

import { agorot, subAgorot, type Agorot } from './money.ts';
import { brandMatches, nameSatisfiesQuery, normalizeBrand, sharesWordWithQuery } from './brand.ts';
import type {
  AlternativeRelation,
  ProductAlternative,
  ProductCandidate,
  ProductChoice,
  ResolutionSource,
} from './types.ts';

export interface ChoiceOptions {
  readonly lineId: string;
  readonly query: string;
  readonly requestedBrand?: string;
  readonly requestedGtin?: string;
  readonly maxAlternatives?: number;
}

/**
 * A tiny pot is rarely what a family means and is usually the worst value per
 * gram, so a candidate is only preferred on unit price among products of a
 * broadly comparable size.
 */
const SIZE_TOLERANCE = 2.5;

export function buildChoice(
  candidates: readonly ProductCandidate[],
  opts: ChoiceOptions,
): ProductChoice | undefined {
  // A product no chain prices cannot be bought, whatever the catalogue says.
  const priced = candidates.filter((c) => c.pricedAtChains > 0);
  if (priced.length === 0) return undefined;

  // A candidate that shares no real word with the query was never an answer to
  // what was typed, however the catalogue ranked it — no candidate, not a
  // guessed one, when nothing in the query matches anything in the name.
  const wordMatched = priced.filter((c) => sharesWordWithQuery(opts.query, c.name));
  if (wordMatched.length === 0) return undefined;

  // Numbers in the query are constraints: "מידה 4" is not size 1, "3%" is not
  // 1%. Prefer candidates that honour them; fall back only if none do.
  const satisfying = wordMatched.filter((c) => nameSatisfiesQuery(opts.query, c.name));
  const buyable = satisfying.length > 0 ? satisfying : wordMatched;

  const wantBrand = normalizeBrand(opts.requestedBrand);

  // --- 1. Choose ------------------------------------------------------------
  let chosen: ProductCandidate | undefined;
  let source: ResolutionSource = 'search';
  let brandHonoured = false;
  let note: string | undefined;

  if (opts.requestedGtin !== undefined) {
    // A barcode the family confirmed outranks anything inferred from the words
    // they typed, so it is looked up before the query constraint is applied.
    chosen = priced.find((c) => c.gtin === opts.requestedGtin);
    if (chosen !== undefined) {
      source = 'gtin';
      brandHonoured = wantBrand === undefined || brandMatches(wantBrand, chosen.brand);
    }
  }

  if (chosen === undefined && wantBrand !== undefined) {
    const onBrand = buyable.filter((c) => brandMatches(wantBrand, c.brand));
    if (onBrand.length > 0) {
      chosen = bestValue(onBrand);
      brandHonoured = true;
    } else {
      // Say so plainly rather than substituting a brand the family did not ask for.
      note = `No ${opts.requestedBrand} product found for "${opts.query}" — showing the closest match instead.`;
    }
  }

  chosen ??= bestValue(buyable);
  if (chosen === undefined) return undefined;

  // --- 2. Offer alternatives ------------------------------------------------
  const alternatives = rankAlternatives(buyable, chosen, wantBrand).slice(
    0,
    opts.maxAlternatives ?? 4,
  );

  return {
    lineId: opts.lineId,
    query: opts.query,
    ...(opts.requestedBrand !== undefined ? { requestedBrand: opts.requestedBrand } : {}),
    chosen,
    alternatives,
    source,
    brandHonoured,
    ...(note !== undefined ? { note } : {}),
  };
}

/**
 * Best value among comparable sizes.
 *
 * Ranking purely on unit price picks the biggest pack every time, which is not
 * what a family means by "cottage cheese". So: anchor on the most commonly
 * stocked size, keep everything within a factor of the anchor, and take the
 * cheapest per unit inside that band.
 */
function bestValue(candidates: readonly ProductCandidate[]): ProductCandidate | undefined {
  const withUnit = candidates.filter((c) => c.unitPrice !== undefined);
  if (withUnit.length === 0) {
    return [...candidates].sort((a, b) => b.pricedAtChains - a.pricedAtChains)[0];
  }

  // The size stocked by the most chains is the household-normal size.
  const anchor = [...withUnit].sort(
    (a, b) => b.pricedAtChains - a.pricedAtChains || (a.unitPrice ?? 0) - (b.unitPrice ?? 0),
  )[0];
  const anchorSize = anchor?.sizeQty;

  const comparable =
    anchorSize === undefined || anchorSize <= 0
      ? withUnit
      : withUnit.filter((c) => {
          if (c.sizeQty === undefined || c.sizeQty <= 0) return false;
          if (c.sizeUnit !== anchor?.sizeUnit) return false;
          const ratio = c.sizeQty / anchorSize;
          return ratio <= SIZE_TOLERANCE && ratio >= 1 / SIZE_TOLERANCE;
        });

  const pool = comparable.length > 0 ? comparable : withUnit;
  return [...pool].sort(
    (a, b) => (a.unitPrice ?? 0) - (b.unitPrice ?? 0) || b.pricedAtChains - a.pricedAtChains,
  )[0];
}

function rankAlternatives(
  all: readonly ProductCandidate[],
  chosen: ProductCandidate,
  wantBrand: string | undefined,
): ProductAlternative[] {
  const chosenBrand = normalizeBrand(chosen.brand);

  const out: ProductAlternative[] = [];

  // One alternative per rival brand keeps the list a decision, not a catalogue —
  // but it must be that brand's BEST offer, not whichever happened to come first.
  const bestPerRivalBrand = new Map<string, ProductCandidate>();
  for (const c of all) {
    if (c.productId === chosen.productId) continue;
    const brand = normalizeBrand(c.brand);
    if (brand !== undefined && brand === chosenBrand) continue;
    const key = brand ?? c.name;
    const held = bestPerRivalBrand.get(key);
    if (held === undefined || (c.unitPrice ?? Infinity) < (held.unitPrice ?? Infinity)) {
      bestPerRivalBrand.set(key, c);
    }
  }
  const rivals = new Set([...bestPerRivalBrand.values()].map((c) => c.productId));

  for (const c of all) {
    if (c.productId === chosen.productId) continue;

    const brand = normalizeBrand(c.brand);
    const sameBrand = brand !== undefined && brand === chosenBrand;
    if (!sameBrand && !rivals.has(c.productId)) continue;

    const relation: AlternativeRelation = sameBrand
      ? c.sizeQty !== chosen.sizeQty
        ? 'same_brand_other_size'
        : 'same_brand_other_variant'
      : 'other_brand';

    // Same basis is necessary but not sufficient: the catalogue reported one
    // nappy pack at ₪36.90/piece and another at ₪1.39/piece — per-pack versus
    // per-nappy under the same label — and truffle oil at 12× the price of
    // olive oil under the same "per_100ml". A gap that wide is not a price
    // difference, it is a different product or a broken basis, and claiming a
    // percentage on it would be a lie the family might act on.
    const comparable =
      c.unitPrice !== undefined &&
      chosen.unitPrice !== undefined &&
      c.unitBasis === chosen.unitBasis &&
      plausibleRatio(c.unitPrice, chosen.unitPrice);

    const delta = comparable ? subAgorot(c.unitPrice!, chosen.unitPrice!) : undefined;
    const percent =
      comparable && chosen.unitPrice! > 0
        ? Math.round((-(delta ?? 0) / chosen.unitPrice!) * 100)
        : undefined;

    out.push({
      candidate: c,
      relation,
      ...(delta !== undefined ? { unitPriceDelta: delta } : {}),
      ...(percent !== undefined ? { percentDelta: percent } : {}),
      reason: describe(relation, percent, wantBrand !== undefined && !sameBrand),
    });
  }

  // Cheapest per unit first; unpriceable alternatives last.
  return out.sort(
    (a, b) => (a.unitPriceDelta ?? agorot(1e9)) - (b.unitPriceDelta ?? agorot(1e9)),
  );
}

function describe(
  relation: AlternativeRelation,
  percent: number | undefined,
  offBrand: boolean,
): string {
  const money =
    percent === undefined
      ? 'price not comparable'
      : percent > 0
        ? `${percent}% cheaper per unit`
        : percent < 0
          ? `${-percent}% dearer per unit`
          : 'same price per unit';

  switch (relation) {
    case 'same_brand_other_size':
      return `Same brand, different size — ${money}`;
    case 'same_brand_other_variant':
      return `Same brand, different variant — ${money}`;
    case 'other_brand':
      return offBrand ? `Different brand — ${money}` : `Another brand — ${money}`;
  }
}

/** Total the family would save on this line by taking an alternative. */
export function savingIfSwitched(
  alt: ProductAlternative,
  chosen: ProductCandidate,
  quantity: number,
): Agorot | undefined {
  if (alt.candidate.fromPrice === undefined || chosen.fromPrice === undefined) return undefined;
  return agorot(Math.round((chosen.fromPrice - alt.candidate.fromPrice) * quantity));
}

/** Unit prices further apart than this are not the same kind of thing. */
export const MAX_PLAUSIBLE_UNIT_RATIO = 5;

function plausibleRatio(a: Agorot, b: Agorot): boolean {
  if (a <= 0 || b <= 0) return false;
  const r = a > b ? a / b : b / a;
  return r <= MAX_PLAUSIBLE_UNIT_RATIO;
}
