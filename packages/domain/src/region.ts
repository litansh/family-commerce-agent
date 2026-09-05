/**
 * Regions.
 *
 * A household lives somewhere, and everything downstream follows from where:
 * which price providers exist, what currency totals are in, which language
 * and direction the app renders, and what a "chain" even is. The domain
 * stays currency-agnostic — money is integer minor units everywhere — and
 * region is data, not code paths.
 *
 * Pricing is region-gated; the shared list, memory and the forgetting check
 * work everywhere from day one, because they depend only on the household.
 */

export type CountryCode = 'IL' | 'US' | 'GB' | 'DE' | 'FR' | 'CA' | 'AU' | 'NL' | 'ES' | 'IT';
export type Currency = 'ILS' | 'USD' | 'GBP' | 'EUR' | 'CAD' | 'AUD';
export type Locale = 'he' | 'en' | 'de' | 'fr' | 'nl' | 'es' | 'it';

export interface Region {
  readonly country: CountryCode;
  readonly currency: Currency;
  readonly locale: Locale;
  readonly rtl: boolean;
  /** Distance unit for the travel model. */
  readonly distance: 'km' | 'mi';
  /** Whether a price provider exists for this region yet. */
  readonly pricingAvailable: boolean;
}

export const REGIONS: Readonly<Record<CountryCode, Region>> = {
  IL: { country: 'IL', currency: 'ILS', locale: 'he', rtl: true, distance: 'km', pricingAvailable: true },
  US: { country: 'US', currency: 'USD', locale: 'en', rtl: false, distance: 'mi', pricingAvailable: false },
  GB: { country: 'GB', currency: 'GBP', locale: 'en', rtl: false, distance: 'mi', pricingAvailable: false },
  CA: { country: 'CA', currency: 'CAD', locale: 'en', rtl: false, distance: 'km', pricingAvailable: false },
  AU: { country: 'AU', currency: 'AUD', locale: 'en', rtl: false, distance: 'km', pricingAvailable: false },
  DE: { country: 'DE', currency: 'EUR', locale: 'de', rtl: false, distance: 'km', pricingAvailable: false },
  FR: { country: 'FR', currency: 'EUR', locale: 'fr', rtl: false, distance: 'km', pricingAvailable: false },
  NL: { country: 'NL', currency: 'EUR', locale: 'nl', rtl: false, distance: 'km', pricingAvailable: false },
  ES: { country: 'ES', currency: 'EUR', locale: 'es', rtl: false, distance: 'km', pricingAvailable: false },
  IT: { country: 'IT', currency: 'EUR', locale: 'it', rtl: false, distance: 'km', pricingAvailable: false },
};

export const DEFAULT_REGION: Region = REGIONS.IL;

export function regionOf(country: string | undefined): Region {
  const c = (country ?? '').toUpperCase() as CountryCode;
  return REGIONS[c] ?? DEFAULT_REGION;
}

const SYMBOL: Record<Currency, string> = { ILS: '₪', USD: '$', GBP: '£', EUR: '€', CAD: 'CA$', AUD: 'A$' };

/** Format minor units in a currency: 83620 ILS → "₪836.20", 1234 USD → "$12.34". */
export function formatMoney(minor: number, currency: Currency): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const major = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, '0');
  const sym = SYMBOL[currency];
  // Symbol-before for every supported currency; locale-specific grouping is
  // the app's job, this keeps the domain deterministic and testable.
  return `${sign}${sym}${major}.${cents}`;
}
