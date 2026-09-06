/**
 * How each store is connected. The login page and how we know the person is
 * in are per-store; everything else in the link flow is shared.
 *
 * loginKind is only a hint for the copy ("enter the SMS code" vs "Face ID
 * fills your password"); the WebView shows the store's real page either way.
 */
export interface StoreDef {
  readonly id: string;
  readonly name: string;
  readonly loginUrl: string;
  /** OTP (phone + SMS, no password) or password (autofilled). */
  readonly loginKind: 'otp' | 'password';
  /** URL that only loads for a signed-in session; used to detect success. */
  readonly signedInProbe: string;
  /** A JS expression evaluated in the WebView that returns true when signed in. */
  readonly signedInCheck: string;
}

export const STORES: Record<string, StoreDef> = {
  shufersal: {
    id: 'shufersal',
    name: 'שופרסל',
    loginUrl: 'https://www.shufersal.co.il/online/he/login',
    loginKind: 'password',
    signedInProbe: 'https://www.shufersal.co.il/online/he/authentication/get-status-includes-otp',
    signedInCheck: `fetch('/online/he/authentication/get-status-includes-otp',{credentials:'include',headers:{'x-requested-with':'XMLHttpRequest'}}).then(r=>r.text()).then(t=>t.trim()==='true'||t.trim().startsWith('{')).catch(()=>false)`,
  },
  'rami-levy': {
    id: 'rami-levy',
    name: 'רמי לוי',
    loginUrl: 'https://www.rami-levy.co.il/he/online',
    loginKind: 'otp',
    signedInProbe: 'https://www.rami-levy.co.il/api/v2/site',
    signedInCheck: `(!!document.querySelector('a[href*="my-account"],[class*="user-name"],[class*="account"]'))`,
  },
};

export const storeName = (id: string): string => STORES[id]?.name ?? id;
