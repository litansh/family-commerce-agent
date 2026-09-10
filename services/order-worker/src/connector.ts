/**
 * What a retailer connector must do to place an order through Kaniti.
 *
 * Every step reports back, because the family approves the final total inside
 * Kaniti before anything irreversible happens. A connector may be slow and
 * careful; it may never place an order unless `placeOrder` is called with an
 * approval token the family created.
 */
import type { Agorot, Coupon } from '@fca/domain';
import type { BrowserContext } from 'playwright';

export interface OrderLine {
  readonly lineId: string;
  readonly query: string;
  readonly gtin?: string;
  readonly productName?: string;
  readonly amount?: number;
  readonly unit?: string;
  readonly packQty?: number;
}

export interface CartLineResult {
  readonly lineId: string;
  readonly status: 'added' | 'substituted' | 'unavailable';
  readonly productName?: string;
  readonly qty?: number;
  readonly note?: string;
}

export interface DeliverySlot {
  readonly id: string;
  readonly label: string;
}

export interface PreparedOrder {
  readonly retailer: string;
  readonly total: Agorot;
  readonly slot: DeliverySlot;
  readonly paymentMethod: string;
  /** Path of a screenshot of the retailer's final review page, for the audit log. */
  readonly reviewShot: string;
}

export interface PlacedOrder {
  readonly retailerOrderId: string;
  readonly confirmationShot: string;
}

export interface PastOrderRaw {
  readonly at: string;
  readonly lines: readonly { name: string; code?: string | undefined; qty: number }[];
}

export interface RetailerConnector {
  readonly id: string;
  /** Past orders from the signed-in account, newest first. Names and quantities; barcodes if the site has them. */
  orderHistory(limit?: number): Promise<readonly PastOrderRaw[]>;
  /** Personal coupons loaded on the account. Empty when the retailer has none or the page is unknown. */
  coupons(): Promise<readonly Coupon[]>;
  /** Open the retailer's login page and resolve once the person has signed in. */
  interactiveLogin(): Promise<BrowserContext>;
  /** Attach to a saved session. Rejects if the retailer no longer accepts it. */
  resume(): Promise<void>;
  /** Empty the cart, add every line, and report what actually landed. */
  fillCart(lines: readonly OrderLine[]): Promise<readonly CartLineResult[]>;
  listSlots(): Promise<readonly DeliverySlot[]>;
  /** Walk to the retailer's final review page and read the real total. Does NOT place the order. */
  prepare(slot: DeliverySlot): Promise<PreparedOrder>;
  /** The irreversible step. Only after an approval recorded in Kaniti. */
  placeOrder(approvalToken: string): Promise<PlacedOrder>;
  close(): Promise<void>;
}
