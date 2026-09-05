/**
 * Price providers by region.
 *
 * Israel has a free, complete price layer; nowhere else does yet. A region
 * without a provider still gets the shared list, the household memory and
 * the forgetting check, which is most of the product - only the priced
 * comparison is gated. Adding a country means adding an entry here, not
 * touching the domain.
 */
import type { Region } from '@fca/domain';
import { type CatalogProvider, type QuoteProvider } from '@fca/retailer-connectors';
export interface RegionProviders {
    readonly quote: QuoteProvider;
    readonly catalog: CatalogProvider;
}
export declare function providersFor(region: Region): RegionProviders | undefined;
