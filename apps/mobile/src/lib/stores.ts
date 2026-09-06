/**
 * How each store is connected - grouped by how the store actually behaves,
 * because the chains share a handful of e-commerce platforms:
 *
 *   code      Rami Levy (own SPA), Victory, Wolt: e-mail/phone → SMS code.
 *             One tap; iOS types the code. Nothing to remember.
 *   platform  Victory, Bitan/Carrefour, Keshet Taamim, Mahsanei HaShuk, Tiv Taam
 *             run one platform: `?loginOrRegister=1` opens its login dialog.
 *             SMS login is a per-chain switch (on at Victory, off elsewhere).
 *   hybris    Shufersal (SAP Hybris): e-mail + password only.
 *   other     Hatzi Hinam: its own password page.
 *
 * Every store is browsable and priced without connecting; connecting is asked
 * once, at the first purchase from that store. The detectors below flip
 * "connected" automatically, and the person can always confirm by hand.
 */
export interface StoreDef {
  readonly id: string;
  readonly name: string;
  readonly loginUrl: string;
  /** OTP (phone/e-mail + SMS code, no password) or password (autofilled by the phone). */
  readonly loginKind: 'otp' | 'password';
  /** Which platform recipe this store follows. */
  readonly group: 'code' | 'platform' | 'hybris' | 'other';
  /** A JS expression evaluated in the WebView that returns true when signed in. */
  readonly signedInCheck: string;
  /** JS run after each page load: open the store's login dialog so the person lands on the one field that matters. */
  readonly openLoginJs?: string;
  /** JS that fills the person's e-mail into the login form (their own address, on their own device). */
  readonly prefillEmailJs?: (email: string) => string;
  /** JS that opens the store's "create/reset password" flow, for stores that insist on a password. */
  readonly forgotJs?: string;
  /** Storefront ids (SuperMCP) this store fulfils, matched by regexp. */
  readonly storefront: RegExp;
  /**
   * JS run in the signed-in WebView that reads past orders through the store's
   * own API and posts `history:{orders:[{at,lines:[{name,code?,qty}]}],diag}`.
   * Stores without one fall back to the generic Hybris reader.
   */
  readonly historyJs?: string;
}

const setInput = (selector: string, value: string) =>
  `(()=>{const i=document.querySelector(${JSON.stringify(selector)});if(i&&!i.value){const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(i,${JSON.stringify(value)});i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));}})();true;`;

/** Generic "am I in": a logout control or the person's account area, and no login prompt in the header. */
const genericSignedIn = `(()=>{const h=((document.querySelector('header')||document.body).innerText||'').slice(0,800);if(!h)return false;const out=/התנתק|יציאה מהחשבון|החשבון שלי|שלום[, ]|logout/i.test(h)||!!document.querySelector('a[href*="logout" i],button[class*="logout" i]');const inn=/(^|\\s)(כניסה|התחברות|כניסה לחשבון)(\\s|$)/.test(h);return out&&!inn;})()`;

/** The shared platform (Victory, Bitan, Keshet, MCK, Tiv Taam). */
const platform = (id: string, name: string, host: string, storefront: RegExp, otp: boolean): StoreDef => ({
  id, name, group: 'platform', storefront,
  // The platform serves a separate phone app ("mobileZuz"); its login lives at
  // /login (desktop uses ?loginOrRegister=1, which the phone version ignores).
  loginUrl: `https://${host}/login`,
  loginKind: otp ? 'otp' : 'password',
  signedInCheck: genericSignedIn,
  // If no login form is on screen yet, open it from the header ("כניסה" /
  // "התחברות" / "כניסה לחשבון"); then, where the chain offers it, prefer the
  // SMS tab so the person never meets a password field.
  // The platform is stor.ai. On the phone the login lives in the side menu
  // ("כניסת משתמש"); on desktop it is a header link. Open whichever exists.
  openLoginJs: `(()=>{const has=document.querySelector('input[type="password"],input[type="tel"],input[type="email"]');if(!has){let b=document.querySelector('button.login')||[...document.querySelectorAll('button,a')].find(x=>/^\\s*(כניסת משתמש|כניסה|התחברות|כניסה לחשבון|התחברות לחשבון)\\s*$/.test(x.textContent||''));const vis=b&&b.getBoundingClientRect().width>0;if(b&&vis){b.click();}else{const m=document.querySelector('.btn-toggle-side-nav,button[class*="side-nav"]');if(m){m.click();setTimeout(()=>{const l=document.querySelector('button.login')||[...document.querySelectorAll('button,a')].find(x=>/כניסת משתמש|^\\s*כניסה\\s*$/.test(x.textContent||''));if(l)l.click();},700);}}}${otp ? `setTimeout(()=>{const o=[...document.querySelectorAll('button,a')].find(x=>/קוד חד פעמי/.test(x.textContent||''));if(o&&!document.querySelector('input[type="tel"]'))o.click();},1600);` : ''}})();true;`,
  prefillEmailJs: (email) => setInput('input[type="email"]', email),
  forgotJs: `(()=>{const a=[...document.querySelectorAll('a,button')].find(x=>/שכחת/.test(x.textContent||''));if(a)a.click();})();true;`,
});

export const STORES: Record<string, StoreDef> = {
  'rami-levy': {
    id: 'rami-levy', name: 'רמי לוי', group: 'code', storefront: /rami-levy/i,
    // No password anywhere: e-mail → "send me a code" → the SMS code, which iOS
    // fills in by itself. The site opens its login dialog from a header button.
    loginUrl: 'https://www.rami-levy.co.il/he',
    loginKind: 'otp',
    // The site is a Nuxt app: its auth module knows whether you are in. Fall
    // back to the header, which reads "כניסה" (phone) / "התחברות" (desktop)
    // while logged out and shows the person's name or "התנתקות" once in.
    signedInCheck: `(()=>{try{const n=window.$nuxt;if(n&&n.$auth&&typeof n.$auth.loggedIn==='boolean')return n.$auth.loggedIn;if(n&&n.$store&&n.$store.state&&n.$store.state.auth&&typeof n.$store.state.auth.loggedIn==='boolean')return n.$store.state.auth.loggedIn;}catch(e){}return ${genericSignedIn};})()`,
    // On the phone the trigger is a <div aria-label="התחברות">, not a button.
    openLoginJs: `(()=>{if(document.querySelector('input[type="email"]'))return;const b=document.querySelector('[aria-label="התחברות"],[aria-label="כניסה"]')||[...document.querySelectorAll('button,a,div,span')].find(x=>x.children.length<3&&/^\\s*(התחברות|כניסה)\\s*$/.test(x.textContent||''));if(b)b.click();})();true;`,
    prefillEmailJs: (email) => setInput('dialog input[type="email"],[role="dialog"] input[type="email"],input[type="email"]', email),
  },
  victory: platform('victory', 'ויקטורי', 'www.victoryonline.co.il', /victory/i, true),
  wolt: {
    id: 'wolt', name: 'וולט (Wolt Market, ויקטורי, קשת, מחסני השוק)', group: 'code', storefront: /wolt/i,
    loginUrl: 'https://wolt.com/he/isr',
    loginKind: 'otp',
    // Signed in = the app holds a refresh token (a cookie its own JS can read).
    signedInCheck: `(()=>{return /(^|;\\s*)__wrtoken=[^;]{20,}/.test(document.cookie)&&!document.querySelector('input[type="email"]');})()`,
    // Refresh-token cookie → bearer → the orders page API; keep grocery venues only
    // (restaurants would teach the family's "usuals" the wrong things).
    historyJs: `(async()=>{const D={};try{
  const get=(n)=>{const c=document.cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith(n+'='));return c?decodeURIComponent(c.slice(n.length+1)):''};
  const tr=await (await fetch('https://authentication.wolt.com/v1/wauth2/access_token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'grant_type=refresh_token&refresh_token='+encodeURIComponent(get('__wrtoken'))})).json();
  D.token=!!tr.access_token;
  const H={accept:'application/json',authorization:'Bearer '+tr.access_token,'app-language':'he','platform':'Web'};
  const out=[];let page='';
  for(let i=0;i<3;i++){
    const r=await fetch('https://consumer-api.wolt.com/order-xp/web/v1/pages/orders'+(page?'?page_token='+encodeURIComponent(page):''),{headers:H});
    const j=await r.json().catch(()=>({}));D.status=r.status;
    for(const o of (j.orders||[])){
      const v=(o.venue&&o.venue.name)||'';
      if(!/מרקט|market|ויקטורי|victory|קשת|keshet|מחסני|hashuk|סופר|super|שופרסל|טיב טעם|חצי חינם|carrefour|קרפור/i.test(v))continue;
      const m=String(o.timestamp||'').match(/(\\d{2})\\/(\\d{2})\\/(\\d{4})/);const at=m?m[3]+'-'+m[2]+'-'+m[1]:'';
      const lines=(o.items||[]).filter(x=>x&&x.name).map(x=>({name:String(x.name).slice(0,80),qty:Number(x.count||1)||1}));
      if(lines.length)out.push({at,lines,venue:v});
    }
    page=j.next_page_token||'';if(!page)break;
  }
  D.orders=out.length;
  window.ReactNativeWebView.postMessage('history:'+JSON.stringify({orders:out,diag:D}));
}catch(e){window.ReactNativeWebView.postMessage('history:'+JSON.stringify({orders:[],diag:{error:String(e),...D}}));}})();true;`,
    openLoginJs: `(()=>{if(document.querySelector('input[type="email"],input[type="tel"]'))return;const b=[...document.querySelectorAll('a,button')].find(x=>/להתחבר|התחברות|Log in|Login/.test(x.textContent||''));if(b)b.click();})();true;`,
    prefillEmailJs: (email) => setInput('input[type="email"]', email),
  },
  shufersal: {
    id: 'shufersal', name: 'שופרסל', group: 'hybris', storefront: /shufersal/i,
    loginUrl: 'https://www.shufersal.co.il/online/he/login',
    loginKind: 'password',
    // Logged out, the orders page 302s to /login; logged in it is a 200 at its own URL.
    signedInCheck: `fetch('/online/he/my-account/orders',{credentials:'include'}).then(r=>r.ok&&!/\\/login/.test(r.url)).catch(()=>false)`,
    prefillEmailJs: (email) => setInput('input[name="j_username"],input[type="email"],input[placeholder*="מייל"]', email),
    forgotJs: `(()=>{const a=[...document.querySelectorAll('a')].find(x=>/שכחתי/.test(x.textContent));if(a)a.click();})();true;`,
  },
  carrefour: platform('carrefour', 'קרפור / ביתן', 'www.ybitan.co.il', /carrefour|ybitan|quik/i, false),
  'keshet-teamim': platform('keshet-teamim', 'קשת טעמים', 'www.keshet-teamim.co.il', /keshet/i, false),
  'mahsanei-hashuk': platform('mahsanei-hashuk', 'מחסני השוק', 'www.mck.co.il', /mck|mahsanei|hashuk/i, false),
  'tiv-taam': platform('tiv-taam', 'טיב טעם', 'www.tivtaam.co.il', /tiv-?taam/i, false),
  'hazi-hinam': {
    id: 'hazi-hinam', name: 'חצי חינם', group: 'other', storefront: /hazi|hinam/i,
    loginUrl: 'https://shop.hazi-hinam.co.il/authentication/login',
    loginKind: 'password',
    signedInCheck: genericSignedIn,
    // Their "e-mail / ID" box is a plain text field above the password.
    prefillEmailJs: (email) => setInput('#userName,input[type="email"],input[name*="mail" i],input[name*="user" i],form input[type="text"]', email),
    forgotJs: `(()=>{const a=[...document.querySelectorAll('a,button')].find(x=>/שכחתי/.test(x.textContent||''));if(a)a.click();})();true;`,
  },
};

export const storeName = (id: string): string => STORES[id]?.name ?? id;
/** Which store (if any) can place an order at this storefront. */
export const storeForStorefront = (storefrontId: string): StoreDef | undefined => Object.values(STORES).find((s) => s.storefront.test(storefrontId));
/** One-tap stores first, then the rest, alphabetical within a group. */
export const STORE_ORDER: string[] = Object.values(STORES).sort((a, b) => Number(b.loginKind === 'otp') - Number(a.loginKind === 'otp')).map((s) => s.id);
