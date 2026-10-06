/**
 * Every store the cloud can sign in to by itself. A store missing here has
 * no cloud rung: the phone's WebView is the only way in (ADR 0008).
 *
 * Verified 2026-09-10 (apps/mobile/e2e/login-api-lab.mjs and the curl probes
 * recorded in docs/adr/0008): Rami Levy and Wolt gate their code flows behind
 * reCAPTCHA / hCaptcha widgets bound to their own pages, and the stor.ai chains
 * (Victory, Carrefour, Keshet, Mahsanei HaShuk, Tiv Taam) do the same and
 * block datacenter addresses on top — so none of them appear below.
 */
import type { StoreDriver } from '../driver.ts';
import { shufersalDriver } from './shufersal.ts';
import { haziHinamDriver } from './hazi-hinam.ts';

export const DRIVERS: Readonly<Record<string, StoreDriver>> = {
  [shufersalDriver.id]: shufersalDriver,
  [haziHinamDriver.id]: haziHinamDriver,
};

export const driverFor = (store: string): StoreDriver | undefined => DRIVERS[store];

/** Generic signed-in check for a session the phone captured at a store with no driver: trust the phone's verification, re-check by cookie presence only. */
export const hasSessionCookies = (cookies: readonly { name: string; value: string }[]): boolean => cookies.some((c) => c.value.length >= 8);
