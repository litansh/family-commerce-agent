import {
  resolveBrand,
  shekels,
  type Agorot,
  type ListLine,
  type ProductCandidate,
  type QuotedLine,
  type StorefrontQuote,
} from '@fca/domain';
import { McpClient } from './mcp-client.ts';
import type {
  CatalogProvider,
  CatalogSearchRequest,
  Promotion,
  StorefrontInfo,
  QuoteProvider,
  QuoteRequest,
  QuoteResponse,
  ResolutionAssumption,
} from './quote-provider.ts';

export const SUPERMCP_URL = 'https://supermcp.web.app/mcp';

// --- The vendor's wire shape. Confined to this file on purpose. -------------

interface RawLine {
  itemIndex: number;
  productId?: string;
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  promoApplied?: boolean;
  clubOnly?: boolean;
  couponOnly?: boolean;
  substituted?: boolean;
  substitutionReason?: string | null;
  link?: string;
}

interface RawPlan {
  serviceSlug: string;
  brand: string;
  chainId?: string;
  chainName?: string;
  serviceType?: string;
  itemsSubtotal: number;
  deliveryFee?: number | null;
  deliveredTotal?: number | null;
  meetsMinimum?: boolean;
  minimumOrder?: number | null;
  amountToMinimum?: number | null;
  pricedLines: number;
  requestedLines: number;
  priceFeedStale?: boolean;
  deliveryTerms?: { confidence?: string } | null;
  lines?: RawLine[];
}

interface RawAssumption {
  itemIndex: number;
  query: string;
  selectedName?: string;
  kind?: string;
  reason?: string;
  message?: string;
}

interface RawResult {
  status?: string;
  plans?: RawPlan[];
  assumptions?: RawAssumption[];
}

/**
 * SuperMCP as a QuoteProvider.
 *
 * Two things this deliberately does NOT do:
 *  - it does not use the provider's own splitOrder or ranking. Our optimizer
 *    owns those, so they stay testable and so the household's constants apply.
 *  - it does not let a float price reach the domain. Everything crosses the
 *    boundary as integer agorot.
 */
export class SuperMcpQuoteProvider implements QuoteProvider {
  readonly id = 'supermcp';
  readonly #mcp: McpClient;

  // API Gateway cuts the API off at 30 s. A whole-basket quote takes ~15 s when the provider is
  // well; when it is not, the caller decides: the background compare job retries, the sync route
  // (the ops checks) answers 'stores_slow' in time rather than a gateway 503 after a full minute.
  constructor(url: string = SUPERMCP_URL, timeoutMs = 22_000) {
    this.#mcp = new McpClient(url, timeoutMs);
  }

  async quoteBasket(req: QuoteRequest): Promise<QuoteResponse> {
    const started = Date.now();
    const raw = await this.#mcp.callTool<RawResult>('optimize_delivery', {
      items: req.lines.map(toItem),
      address: req.address,
      // The provider's vocabulary is standard|pickup; ours is delivery|pickup.
      slot_type: req.serviceType === 'pickup' ? 'pickup' : 'standard',
      // 'standard' returns per-line detail for every storefront, which our optimizer
      // needs to build its own splits rather than trusting the provider's.
      response_detail: 'standard',
      ...(req.memberships?.length ? { memberships: req.memberships } : {}),
    });

    const byIndex = new Map(req.lines.map((l, i) => [i, l]));

    const quotes = (raw.plans ?? []).map<StorefrontQuote>((p) => {
      const lines = (p.lines ?? []).map<QuotedLine>((l) => {
        const src = byIndex.get(l.itemIndex);
        // The line itself carries the canonical UUID; the GTIN is only in the
        // retailer deep link (?item=7290004131074). Memory keys on GTIN, so
        // recover it, preferring what the request already knew.
        const gtin = src?.gtin ?? /[?&]item=(\d{8,14})/.exec(l.link ?? '')?.[1];
        return {
          lineId: src?.id ?? `idx-${l.itemIndex}`,
          query: src?.query ?? '',
          productName: l.name,
          ...(gtin !== undefined ? { gtin } : {}),
          qty: l.qty,
          unitPrice: shekels(l.unitPrice),
          lineTotal: shekels(l.lineTotal),
          // The provider marks its own cross-chain resolution as "substituted: chain_equivalent" - that is
          // the same product at this chain, not a swap. A swap is a different product (class_fallback etc.).
          substituted: l.substituted === true && !/^chain_equivalent/i.test(l.substitutionReason ?? ''),
          ...(l.substitutionReason && !/^chain_equivalent/i.test(l.substitutionReason) ? { substitutionReason: l.substitutionReason } : {}),
          clubOnly: l.clubOnly === true,
          resolutionSource: src?.gtin ? 'gtin' : 'provider',
          ...(l.link ? { link: l.link } : {}),
        };
      });

      const fee = shekels(p.deliveryFee ?? 0);
      const subtotal = shekels(p.itemsSubtotal);
      return {
        storefrontId: p.serviceSlug,
        brand: p.brand,
        chainId: p.chainId ?? p.serviceSlug,
        serviceType: p.serviceType === 'pickup' ? 'pickup' : 'delivery',
        itemsSubtotal: subtotal,
        deliveryFee: fee,
        deliveredTotal:
          p.deliveredTotal != null ? shekels(p.deliveredTotal) : ((subtotal + fee) as Agorot),
        meetsMinimum: p.meetsMinimum !== false,
        // Some storefronts publish only the shortfall; recover the minimum from it.
        ...(p.minimumOrder != null ? { minimumOrder: shekels(p.minimumOrder) }
          : p.amountToMinimum != null && p.amountToMinimum > 0 ? { minimumOrder: shekels(p.itemsSubtotal + p.amountToMinimum) } : {}),
        requestedLines: p.requestedLines,
        pricedLines: p.pricedLines,
        lines,
        deliveryTermsConfidence: confidenceOf(p.deliveryTerms?.confidence),
        priceFeedStale: p.priceFeedStale === true,
      };
    });

    // The provider repeats an assumption per storefront it applied to, so the
    // raw array is longer than the list. Resolution quality is a property of a
    // line, not of a storefront, so collapse to one entry per line.
    const assumptions = [
      ...new Map(
        (raw.assumptions ?? []).map<[string, ResolutionAssumption]>((a) => {
          const lineId = byIndex.get(a.itemIndex)?.id ?? `idx-${a.itemIndex}`;
          return [
            lineId,
            {
              lineId,
              query: a.query,
              selectedName: a.selectedName ?? '',
              kind: a.kind ?? 'unknown',
              reason: a.reason ?? '',
              message: a.message ?? '',
            },
          ];
        }),
      ).values(),
    ];

    return { quotes, assumptions, providerId: this.id, latencyMs: Date.now() - started, raw };
  }
}

function toItem(l: ListLine): Record<string, unknown> {
  if (l.gtin) return { gtin: l.gtin, ...quantityOf(l) };
  return { query: l.query, ...quantityOf(l) };
}

/** The provider rejects amount+unit paired with pack_qty, so send exactly one. */
function quantityOf(l: ListLine): Record<string, unknown> {
  if (l.amount !== undefined && l.unit !== undefined) return { amount: l.amount, unit: l.unit };
  if (l.packQty !== undefined) return { pack_qty: l.packQty };
  return { pack_qty: 1 };
}

function confidenceOf(c: string | undefined): StorefrontQuote['deliveryTermsConfidence'] {
  return c === 'verified' ? 'verified' : c === 'assumed' ? 'assumed' : 'unknown';
}

// ---------------------------------------------------------------------------
// Catalogue search
// ---------------------------------------------------------------------------

interface RawProduct {
  id: string;
  gtin?: string | null;
  name: string;
  brand?: string | null;
  sizeQty?: number | null;
  sizeUnit?: string | null;
  fromPrice?: number | null;
  normalizedUnitPrice?: number | null;
  normalizedUnitBasis?: string | null;
  pricedAtChains?: number | null;
}

/**
 * SuperMCP as a CatalogProvider.
 *
 * Brand comes back spelled several ways for one firm ("תנובה", "תנובה בע\"מ",
 * "תנובה חלב"), so the raw spelling is preserved for display and a normalised
 * key is attached for matching. Catalogue entries that no chain prices come back
 * with a null price and zero chains; they are kept here and filtered in the
 * domain, so the reason a product was dropped stays inspectable.
 */
export class SuperMcpCatalogProvider implements CatalogProvider {
  readonly id = 'supermcp';
  readonly #mcp: McpClient;

  // Search is interactive - a family waiting on a keystroke - so it gets a short per-attempt budget,
  // not the whole-basket 60s this used to carry; a stuck call is one rung failing, not a frozen
  // screen. One bounded retry on the vendor's own transient internal_error (docs/adr/0010).
  constructor(url: string = SUPERMCP_URL, timeoutMs = 8_000) {
    this.#mcp = new McpClient(url, timeoutMs, 1);
  }

  async listStorefronts(address: string): Promise<readonly StorefrontInfo[]> {
    type Raw = { serviceSlug?: string; brand?: string; chainName?: string; serviceType?: string; minimumOrder?: number | null; deliveryFeeFrom?: number | null; coverage?: { serves?: boolean } | null };
    const res = await this.#mcp.callTool<{ options?: Raw[] }>('list_delivery_options', { address });
    return (res.options ?? []).filter((o) => o.serviceSlug && o.coverage?.serves !== false).map((o) => ({
      serviceSlug: o.serviceSlug!, brand: o.brand ?? '', chainName: o.chainName ?? '', serviceType: o.serviceType ?? '',
      ...(typeof o.minimumOrder === 'number' ? { minimumOrder: o.minimumOrder } : {}), ...(typeof o.deliveryFeeFrom === 'number' ? { deliveryFeeFrom: o.deliveryFeeFrom } : {}),
    }));
  }

  async listPromotions(limit: number): Promise<readonly Promotion[]> {
    type Raw = { chainName?: string; description?: string; mechanicParams?: { discountRate?: number | null; discountedPrice?: number | null } | null; clubOnly?: boolean; endTs?: string; itemCodes?: string[] };
    const res = await this.#mcp.callTool<{ promotions?: Raw[] }>('get_promotions', { limit });
    return (res.promotions ?? []).flatMap((p) => {
      const price = p.mechanicParams?.discountedPrice;
      if (!p.chainName || typeof price !== 'number' || price <= 0) return [];
      return [{ chainName: p.chainName, description: p.description ?? '', discountRate: p.mechanicParams?.discountRate ?? 0, discountedPrice: price, clubOnly: !!p.clubOnly, endTs: p.endTs ?? '', itemCodes: p.itemCodes ?? [] }];
    });
  }

  async searchProducts(req: CatalogSearchRequest): Promise<readonly ProductCandidate[]> {
    const res = await this.#mcp.callTool<{ products?: RawProduct[] }>('search_products', {
      query: req.query,
      limit: req.limit ?? 20,
      ...(req.brand !== undefined ? { brand: req.brand } : {}),
      ...(req.gtin !== undefined ? { gtin: req.gtin } : {}),
      ...(req.location !== undefined ? { location: req.location } : {}),
    });

    return (res.products ?? []).map<ProductCandidate>((p) => ({
      productId: p.id,
      ...(p.gtin ? { gtin: p.gtin } : {}),
      name: p.name,
      // The catalogue often leaves brand null on a product whose name carries
      // it, so fall back to reading the name.
      ...(resolveBrand(p.brand, p.name) !== undefined
        ? { brand: resolveBrand(p.brand, p.name)! }
        : {}),
      ...(p.brand ? { rawBrand: p.brand } : {}),
      ...(p.sizeQty != null ? { sizeQty: p.sizeQty } : {}),
      ...(p.sizeUnit ? { sizeUnit: p.sizeUnit } : {}),
      ...(p.fromPrice != null ? { fromPrice: shekels(p.fromPrice) } : {}),
      ...(p.normalizedUnitPrice != null ? { unitPrice: shekels(p.normalizedUnitPrice) } : {}),
      ...(p.normalizedUnitBasis ? { unitBasis: p.normalizedUnitBasis } : {}),
      pricedAtChains: p.pricedAtChains ?? 0,
    }));
  }
}
