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
  /**
   * The cloud rung (ADR 0008): what Kaniti's cloud can do for this store with
   * no phone. `password` = e-mail + password typed once into Kaniti and used
   * once; `otp` = the cloud asks the store for its code. Absent = the store
   * gates sign-in behind a captcha or blocks datacenters, so it connects on
   * the phone only.
   */
  readonly cloud?: 'password' | 'otp';
  /** What the store's sign-up form asks a new person for, in its order — so Kaniti can prefill what it knows and say the rest up front. */
  readonly signup: { readonly url: string; readonly asks: readonly SignupField[] };
  /** Cookie / token names that make up a signed-in session on this store, for the phone to capture after sign-in. */
  readonly sessionKeys?: readonly string[];
  /**
   * Ordering on the phone (ADR 0008 amendment): JS run inside the store's own
   * page, in the person's own session, that puts `lines` into the store's cart
   * through the store's own endpoints and posts
   * `cart:{results:[{gtin,status:'added'|'missing'|'error',detail?}],cartUrl?}`.
   * The page then shows the store's cart/checkout for the one approval.
   */
  readonly cartJs?: (lines: readonly CartLine[]) => string;
  /** The store's cart page, shown after the recipe ran (or straight away when there is no recipe). */
  readonly cartUrl?: string;
}
export interface CartLine { readonly gtin?: string; readonly name: string; readonly qty: number; readonly link?: string }
export type SignupField = 'name' | 'id' | 'phone' | 'email' | 'birthdate' | 'password' | 'address' | 'code';

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
  // stor.ai: `/v2/retailers/{id}/sessions` wants a reCAPTCHA hash and the platform 403s datacenters — phone only.
  signup: { url: `https://${host}/?loginOrRegister=1`, asks: otp ? ['phone', 'code'] : ['name', 'phone', 'email', 'password'] },
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
    // `/api/v2/site/auth/login` answers 422 "recaptcha" without a widget token — phone only.
    signup: { url: 'https://www.rami-levy.co.il/he', asks: ['email', 'code'] },
    sessionKeys: ['auth._token.local', 'auth._refresh_token.local'],
    cartUrl: 'https://www.rami-levy.co.il/he/cart',
    // From the site's own bundle: POST www-api…/api/v2/cart {store,isClub,supplyAt,items:{[itemId]:qty},meta}
    // with the session's EcomToken; item ids come from /api/catalog?itemsBy=barcode. Runs in the page,
    // so it is the person's own session and the store sees its own app at work.
    cartJs: (lines) => `(async()=>{const L=${JSON.stringify(lines)};const out=[];try{
  const n=window.$nuxt;const st=(n&&n.$store)?n.$store:null;
  // The site's own anonymous (or signed-in) bearer, read off its axios defaults.
  let auth='';try{const hc=n&&n.$axios&&n.$axios.defaults&&n.$axios.defaults.headers&&n.$axios.defaults.headers.common;auth=(hc&&(hc.Authorization||hc.authorization))||'';}catch(e){}
  auth=String(auth||'');if(auth&&!/^Bearer/i.test(auth))auth='Bearer '+auth;
  // Signed in? then the club/EcomToken comes from the user; a guest sends EcomToken:0.
  let ecom=0,isClub=0;try{const u=st&&st.getters&&st.getters['authuser/loggedInUser'];if(u&&u.token){ecom=u.token;isClub=st.getters['authuser/isClub']?1:0;}}catch(e){}
  // The branch: the site sets it from the chosen delivery address (cart/setStoreId(address.store_id)).
  // A fresh session still sits on the default 331, which stocks a different range - so read the
  // person's own addresses and use the selected one's branch, telling the site's cart the same.
  let store=(st&&st.getters&&st.getters['cart/getStoreId'])||331,branchFrom='default';
  try{const au=st&&st.state&&st.state.authuser;let list=(au&&(au.addresses||au.allAddresses))||(st&&st.getters&&(st.getters['authuser/getAddresses']||st.getters['authuser/addresses']))||[];list=Array.isArray(list)?list:Object.values(list||{});const selId=st&&st.getters&&st.getters['checkout/getAddressSelect'];const a=list.find(x=>x&&selId&&String(x.id)===String(selId))||list[0];if(a&&(a.store_id||a.storeId)){store=a.store_id||a.storeId;branchFrom='address';try{st.commit('cart/setStoreIdNoneUpdateCart',store);}catch(e){}}}catch(e){}
  const codes=L.filter(l=>l.gtin).map(l=>l.gtin);
  const byBarcode={};
  // The catalogue answer has shipped as data[], data.items[], items[] - read all of them, and note the shape for the log.
  const shape={};const rows=(j)=>{if(!j)return[];const c=[j.data,j.items,j.products,j.data&&j.data.items,j.data&&j.data.data,j.results];for(const x of c)if(Array.isArray(x))return x;return[];};
  const lookup=async(body)=>{const r=await fetch('/api/catalog?',{method:'POST',headers:{'content-type':'application/json;charset=utf-8',accept:'application/json'},body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));shape.keys=j&&typeof j==='object'?Object.keys(j).slice(0,6):typeof j;const arr=rows(j);shape.rows=arr.length;return arr;};
  const take=(arr)=>{for(const it of arr){const bc=String(it.barcode||it.Barcode||(it.gs&&it.gs.barcode)||'');const id=it.id||it.C||it.ItemId;if(bc&&id!=null&&!byBarcode[bc])byBarcode[bc]={id,name:it.name||it.Name||''};}};
  if(codes.length){take(await lookup({store,items:codes.join(','),itemsBy:'barcode',size:codes.length}));
    // Not in this branch? try without a branch, then one by one.
    const left=codes.filter(c=>!byBarcode[c]);if(left.length)take(await lookup({items:left.join(','),itemsBy:'barcode',size:left.length}));}
  // Still missing: the store's own text search by the product name, first hit that carries a barcode.
  const byName={};for(const l of L){if(l.gtin&&byBarcode[l.gtin])continue;if(!l.name)continue;try{const arr=await lookup({store,q:l.name,size:5});const hit=arr.find(it=>it&&(it.id||it.C));if(hit){byName[l.name]={id:hit.id||hit.C,name:hit.name||hit.Name||''};}}catch(e){}}
  const qty={};for(const l of L){const hit=(l.gtin&&byBarcode[l.gtin])||byName[l.name];if(hit){qty[hit.id]=(qty[hit.id]||0)+(l.qty||1);out.push({gtin:l.gtin,status:'added',detail:hit.name});}else out.push({gtin:l.gtin,status:'missing',detail:l.name});}
  const items=Object.keys(qty).map(id=>({C:isNaN(+id)?id:+id,Quantity:qty[id]}));
  let cartStatus=0,via='';
  if(items.length){
    const body={store,isClub,supplyAt:null,items,meta:null};
    // Prefer the site's own axios: its request interceptor carries the (anonymous or signed-in) bearer.
    try{if(n&&n.$axios&&n.$axios.post){const rr=await n.$axios.post('https://www.rami-levy.co.il/api/v2/cart',body,{headers:{EcomToken:String(ecom)}});cartStatus=rr&&rr.status||200;via='axios';}}catch(e){cartStatus=(e&&e.response&&e.response.status)||-1;via='axios';}
    if(cartStatus!==200){
      const h={'content-type':'application/json',accept:'application/json'};if(auth)h.Authorization=auth;h.EcomToken=String(ecom);
      const r=await fetch('https://www.rami-levy.co.il/api/v2/cart',{method:'POST',credentials:'include',headers:h,body:JSON.stringify(body)});cartStatus=r.status;via=via+'+fetch';
    }
    if(cartStatus!==200&&cartStatus!==201){for(const o of out)if(o.status==='added'){o.status='error';o.detail='cart '+cartStatus;}}
  }
  window.ReactNativeWebView.postMessage('cart:'+JSON.stringify({results:out,cartUrl:'https://www.rami-levy.co.il/he/cart',diag:{auth:!!auth,signedIn:!!ecom,store,branchFrom,found:Object.keys(byBarcode).length,byName:Object.keys(byName).length,shape,cartStatus,via}}));
}catch(e){window.ReactNativeWebView.postMessage('cart:'+JSON.stringify({results:out,diag:{error:String(e)}}));}})();true;`,
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
    // `/v3/users/email_login` sends a link; hCaptcha guards the flow — phone only.
    signup: { url: 'https://wolt.com/he/isr', asks: ['email', 'code'] },
    sessionKeys: ['__wrtoken', '__wtoken'],
  },
  shufersal: {
    id: 'shufersal', name: 'שופרסל', group: 'hybris', storefront: /shufersal/i,
    loginUrl: 'https://www.shufersal.co.il/online/he/login',
    loginKind: 'password',
    // Logged out, the orders page 302s to /login; logged in it is a 200 at its own URL.
    signedInCheck: `fetch('/online/he/my-account/orders',{credentials:'include'}).then(r=>r.ok&&!/\\/login/.test(r.url)).catch(()=>false)`,
    prefillEmailJs: (email) => setInput('input[name="j_username"],input[type="email"],input[placeholder*="מייל"]', email),
    forgotJs: `(()=>{const a=[...document.querySelectorAll('a')].find(x=>/שכחתי/.test(x.textContent));if(a)a.click();})();true;`,
    // Plain form post, no captcha — but from AWS the site serves a 441-byte block page
    // (verified from a Lambda, 2026-09-10), so there is no cloud rung: phone only.
    signup: { url: 'https://www.shufersal.co.il/online/he/register', asks: ['name', 'id', 'phone', 'email', 'birthdate', 'password'] },
    sessionKeys: ['JSESSIONID', 'XSRF-TOKEN', 'miglogstorefrontRememberMe'],
    cartUrl: 'https://www.shufersal.co.il/online/he/cart',
    // Hybris: POST /online/he/cart/add (productCodePost, qty, CSRFToken from the page). Product codes are
    // P_<barcode>; when that misses, the site's own search finds the code for the barcode.
    cartJs: (lines) => `(async()=>{const L=${JSON.stringify(lines)};const out=[];try{
  const csrf=(document.querySelector('meta[name="_csrf"]')||{}).content||((document.querySelector('input[name="CSRFToken"]')||{}).value)||'';
  const add=async(code,qty)=>{const b=new URLSearchParams({productCodePost:code,qty:String(qty),CSRFToken:csrf});const r=await fetch('/online/he/cart/add',{method:'POST',credentials:'include',headers:{'content-type':'application/x-www-form-urlencoded','x-requested-with':'XMLHttpRequest',accept:'application/json','csrftoken':csrf},body:b.toString()});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch(e){}return {ok:r.ok&&r.url.indexOf('/login')<0&&!(j&&j.error),status:r.status,j};};
  for(const l of L){if(!l.gtin){out.push({gtin:l.gtin,status:'missing'});continue;}
    let res=await add('P_'+l.gtin,l.qty||1);
    if(!res.ok){try{const s=await fetch('/online/he/search/autocomplete?term='+encodeURIComponent(l.gtin),{credentials:'include',headers:{accept:'application/json','x-requested-with':'XMLHttpRequest'}});const sj=await s.json().catch(()=>null);const cand=sj&&(sj.products||sj.suggestions||[]);const code=cand&&cand[0]&&(cand[0].code||cand[0].productCode);if(code)res=await add(code,l.qty||1);}catch(e){}}
    out.push({gtin:l.gtin,status:res.ok?'added':(res.status>=500?'error':'missing'),detail:String(res.status)});}
  window.ReactNativeWebView.postMessage('cart:'+JSON.stringify({results:out,cartUrl:'https://www.shufersal.co.il/online/he/cart',diag:{csrf:!!csrf}}));
}catch(e){window.ReactNativeWebView.postMessage('cart:'+JSON.stringify({results:out,diag:{error:String(e)}}));}})();true;`,
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
    // `/proxy/Login` JSON post, captcha token optional — but Cloudflare challenges AWS
    // addresses (403 "Just a moment", verified from a Lambda, 2026-09-10): phone only.
    signup: { url: 'https://shop.hazi-hinam.co.il/registration/personalDetails', asks: ['name', 'id', 'phone', 'email', 'address', 'password'] },
    sessionKeys: ['H_UUID'],
    cartUrl: 'https://shop.hazi-hinam.co.il/checkout/cart',
    // Angular over /proxy/: resolve a barcode with item/getItemByBarkod/{barcode},
    // then item/addItemToCart {ItemId,Quantity,Type,IsCalculateCart}. The session
    // (H_UUID + bearer the page holds) makes these the person's own cart.
    cartJs: (lines) => `(async()=>{const L=${JSON.stringify(lines)};const out=[];try{
  const B='https://shop.hazi-hinam.co.il/proxy/';
  let auth='';try{auth=(window.sessionStorage.getItem('access_token')||window.localStorage.getItem('access_token')||'');}catch(e){}
  const H={accept:'application/json','content-type':'application/json; charset=utf-8'};if(auth)H.Authorization=/^Bearer/i.test(auth)?auth:'Bearer '+auth;
  const j=async(u,opt)=>{const r=await fetch(B+u,Object.assign({credentials:'include',headers:H},opt||{}));const t=await r.text();let d=null;try{d=JSON.parse(t)}catch(e){}return {s:r.status,d};};
  for(const l of L){if(!l.gtin){out.push({gtin:l.gtin,status:'missing'});continue;}
    const it=await j('item/getItemByBarkod/'+encodeURIComponent(l.gtin));
    const item=it.d&&it.d.IsOK&&it.d.Results&&it.d.Results.Item;
    if(!item){out.push({gtin:l.gtin,status:'missing'});continue;}
    const id=item.Id||item.ItemId;
    const add=await j('item/addItemToCart',{method:'POST',body:JSON.stringify({ItemId:id,Quantity:l.qty||1,Type:0,IsCalculateCart:true})});
    const ok=add.d&&add.d.IsOK;
    out.push({gtin:l.gtin,status:ok?'added':(add.s>=500?'error':'missing'),detail:item.ItemName||item.Name||String(add.s)});}
  window.ReactNativeWebView.postMessage('cart:'+JSON.stringify({results:out,cartUrl:'https://shop.hazi-hinam.co.il/checkout/cart',diag:{auth:!!auth}}));
}catch(e){window.ReactNativeWebView.postMessage('cart:'+JSON.stringify({results:out,diag:{error:String(e)}}));}})();true;`,
  },
};

export const storeName = (id: string): string => STORES[id]?.name ?? id;
/** Which store (if any) can place an order at this storefront. */
export const storeForStorefront = (storefrontId: string): StoreDef | undefined => Object.values(STORES).find((s) => s.storefront.test(storefrontId));
/** One-tap stores first, then the rest, alphabetical within a group. */
export const STORE_ORDER: string[] = Object.values(STORES).sort((a, b) => Number(b.loginKind === 'otp') - Number(a.loginKind === 'otp')).map((s) => s.id);
