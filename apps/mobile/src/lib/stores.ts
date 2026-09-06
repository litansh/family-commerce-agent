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
  /** JS run after each page load: open the store's login dialog so the person lands on the one field that matters. */
  readonly openLoginJs?: string;
  /** JS that fills the person's e-mail into the login form (their own address, on their own device). */
  readonly prefillEmailJs?: (email: string) => string;
  /** JS that opens the store's "create/reset password" flow, for stores that insist on a password. */
  readonly forgotJs?: string;
}

export const STORES: Record<string, StoreDef> = {
  shufersal: {
    id: 'shufersal',
    name: 'שופרסל',
    loginUrl: 'https://www.shufersal.co.il/online/he/login',
    loginKind: 'password',
    signedInProbe: 'https://www.shufersal.co.il/online/he/authentication/get-status-includes-otp',
    // Logged out, the orders page 302s to /login; logged in it is a 200 at its own URL.
    // Follow the redirect and look at where we landed - opaque redirects made the
    // manual variant unreliable inside WKWebView.
    signedInCheck: `fetch('/online/he/my-account/orders',{credentials:'include'}).then(r=>r.ok&&!/\\/login/.test(r.url)).catch(()=>false)`,
    prefillEmailJs: (email) => `(()=>{const i=document.querySelector('input[name="j_username"],input[type="email"],input[placeholder*="מייל"]');if(i&&!i.value){const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(i,${JSON.stringify(email)});i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));}})();true;`,
    forgotJs: `(()=>{const a=[...document.querySelectorAll('a')].find(x=>/שכחתי/.test(x.textContent));if(a)a.click();})();true;`,
  },
  'rami-levy': {
    id: 'rami-levy',
    name: 'רמי לוי',
    // No password anywhere: e-mail → "send me a code" → the SMS code, which iOS
    // fills in by itself. The site opens its login dialog from a header button.
    loginUrl: 'https://www.rami-levy.co.il/he',
    loginKind: 'otp',
    signedInProbe: 'https://www.rami-levy.co.il/api/v2/site',
    // Signed in = the page has hydrated (search box present) and the header no
    // longer offers "התחברות".
    // The site is a Nuxt app: its auth module knows whether you are in. Fall
    // back to the header, which reads "כניסה" (phone) / "התחברות" (desktop)
    // while logged out and shows the person's name or "התנתקות" once in.
    signedInCheck: `(()=>{try{const n=window.$nuxt;if(n&&n.$auth&&typeof n.$auth.loggedIn==='boolean')return n.$auth.loggedIn;if(n&&n.$store&&n.$store.state&&n.$store.state.auth&&typeof n.$store.state.auth.loggedIn==='boolean')return n.$store.state.auth.loggedIn;}catch(e){}const h=((document.querySelector('header')||document.body).innerText||'').slice(0,600);if(!h)return false;return /התנתק|החשבון שלי|שלום[, ]/.test(h)&&!/(^|\\s)(כניסה|התחברות)(\\s|$)/.test(h);})()`,
    openLoginJs: `(()=>{if(document.querySelector('dialog input[type="email"],[role="dialog"] input[type="email"]'))return;const b=[...document.querySelectorAll('button,a')].find(x=>/^\\s*(התחברות|כניסה)\\s*$/.test(x.textContent||''));if(b)b.click();})();true;`,
    prefillEmailJs: (email) => `(()=>{const i=document.querySelector('dialog input[type="email"],[role="dialog"] input[type="email"],input[type="email"]');if(i&&!i.value){const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(i,${JSON.stringify(email)});i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));}})();true;`,
  },
};

export const storeName = (id: string): string => STORES[id]?.name ?? id;
