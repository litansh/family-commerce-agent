/**
 * Scripts injected into a store's WebView by the connect screen (StoreLink) and the
 * keep-alive (SessionKeeper). They live here, apart from the React screens, so
 * `e2e/recipe-syntax.mjs` can parse every one of them: a broken string fails
 * silently inside a WebView, and one did — a `\/` in a template literal turned the
 * Cloudflare guard into an invalid regex flag (2026-09-11), which took the signed-in
 * poll, the code-box wiring, the consent sheet and the session capture down with it
 * for every store until the log showed nothing arriving.
 *
 * Plain strings evaluated inside the WebView: no `\/` escapes, no top-level `return`.
 */
import { GUARD_JS } from './session.ts';

/** Run `js` only while no Cloudflare step is on screen; the guard's verdict is posted first. */
export const guardedJs = (js: string): string => `(()=>{const g=${GUARD_JS};window.ReactNativeWebView.postMessage('guard:'+g);if(g)return;${js}})();true;`;

// The moment a store shows a "code" box, mark it as a one-time-code field
// and focus it. iOS then offers the SMS code on the keyboard as it lands —
// one tap, well inside the store's timer — instead of a race to type six
// digits from Messages. Runs continuously: code boxes appear after taps.
export const OTP_JS = `(()=>{if(window.__kanitiOtp)return;window.__kanitiOtp=1;
  // Strict: a code box is a short field (4-8 chars) whose own name/id/autocomplete says so.
  // Never a 20-char text field that merely mentions a word - rewriting those broke Shufersal's forms.
  const isCode=(i)=>{if(i.type==='tel'||i.type==='password'||i.type==='email'||i.type==='search')return false;const n=(i.name||'')+' '+(i.id||'');const ac=i.getAttribute('autocomplete')||'';if(/phone|tel|zip|idNumber|birth/i.test(n))return false;const ml=Number(i.getAttribute('maxlength')||0);if(ac==='one-time-code')return true;if(ml<4||ml>8)return false;return /otp|sms.?code|smscode|one.?time|verif|code$|^code|_code|codeinput/i.test(n)||i.getAttribute('inputmode')==='numeric'||/^\\\\d\\*$/.test(i.getAttribute('pattern')||'');};
  const fire=(i)=>{for(const t of ['input','keydown','keyup','change'])try{i.dispatchEvent(t==='input'?new Event('input',{bubbles:true}):t==='change'?new Event('change',{bubbles:true}):new KeyboardEvent(t,{bubbles:true,key:'0'}));}catch(e){}};
  const submitOf=(i)=>{const f=i.closest('form');const c=f||document;
    // NEVER the "send/resend a code" button - clicking it invalidates the code the person just typed.
    const resend=(t)=>/שלח.*קוד|קוד.*חדש|resend|send.*code|get.*code/i.test(t);
    const label=(x)=>((x.textContent||x.value||'')+' '+(x.getAttribute('aria-label')||'')).trim();
    const btns=[...c.querySelectorAll('button,input[type="submit"],a.btn,[role="button"]')].filter(x=>x.getBoundingClientRect().width>0&&!x.disabled&&!resend(label(x)));
    // Confirm/continue only. Prefer an exact "אישור"/verify; then a contains match.
    return btns.find(x=>/^(אישור|אמת|המשך|כניסה|התחבר|verify|confirm|continue|submit|ok)$/i.test(label(x)))||btns.find(x=>/אישור|אמת|המשך|כניסה|התחבר|verify|confirm|continue|submit/i.test(label(x)))||null;};
  const report=(i,why)=>{try{const f=i.closest('form');const out={why,href:location.href,field:{name:i.name,id:i.id,type:i.type,ml:i.maxLength,ac:i.getAttribute('autocomplete'),len:(i.value||'').length},form:f?{id:f.id,action:f.getAttribute('action'),method:f.method}:null,buttons:[...(f||document).querySelectorAll('button,input[type="submit"]')].filter(x=>x.getBoundingClientRect().width>0).map(x=>((x.textContent||x.value||'').trim().slice(0,30)+(x.disabled?'(disabled)':''))).slice(0,8),text:(document.body.innerText||'').replace(/\\\\s+/g,' ').slice(0,300)};window.ReactNativeWebView.postMessage('probe:'+JSON.stringify(out));}catch(e){}};
  // Password autofill (iOS Passwords + Face ID, Android Autofill) offers a saved login only when
  // the fields carry the standard markers; many stores omit them. Add, never overwrite.
  const autofill=()=>{try{const pw=[...document.querySelectorAll('input[type="password"]')].filter(x=>x.getBoundingClientRect().width>0);for(const p of pw){if(!p.getAttribute('autocomplete'))p.setAttribute('autocomplete','current-password');const f=p.closest('form')||document;const u=[...f.querySelectorAll('input[type="email"],input[type="text"],input[type="tel"]')].filter(x=>x!==p&&x.getBoundingClientRect().width>0&&!isCode(x))[0];if(u&&!u.getAttribute('autocomplete'))u.setAttribute('autocomplete',u.type==='tel'?'tel':'username');}}catch(e){}};
  const tune=()=>{autofill();for(const i of document.querySelectorAll('input')){if(i.type==='hidden'||i.type==='password'||i.type==='email'||i.type==='search')continue;if(!isCode(i))continue;
    if(i.getAttribute('autocomplete')!=='one-time-code'){i.setAttribute('autocomplete','one-time-code');i.setAttribute('inputmode','numeric');i.setAttribute('pattern','[0-9]*');}
    if(!i.dataset.kanitiWired){i.dataset.kanitiWired='1';report(i,'code box seen');
      // A pasted / autofilled code arrives as one input event; sites that listen for keyup never see it.
      // Replay the key events, and when the code is complete, press the page's own continue button.
      // Replay the key events a paste / autofill skips, so the page's own validation runs.
      // Nothing is clicked for the person: the page's confirm button is theirs to tap.
      i.addEventListener('input',()=>{fire(i);const v=(i.value||'').trim();if(v.length>=(i.maxLength>0?i.maxLength:6))report(i,'code complete: '+(submitOf(i)?'confirm button present':'no confirm button'));});}}};
  tune();new MutationObserver(()=>tune()).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style']});})();true;`;

// Cookie / consent sheets sit on top of many store logins (Wolt, Hatzi Hinam). Take the
// minimal choice for the person ("use only necessary" / "אישור" / close) so the login is reachable.
export const CONSENT_JS = `(()=>{try{const vis=(e)=>e.getBoundingClientRect().width>0;const ctx=(e)=>{let n=e,d=0;while(n&&d<6){const t=((n.id||'')+' '+(n.className||'')+' '+(n.getAttribute&&n.getAttribute('aria-label')||'')).toLowerCase();if(/cookie|consent|gdpr|privacy|onetrust|cc-|banner/.test(t))return true;n=n.parentElement;d++;}return false;};
  const btns=[...document.querySelectorAll('button,a,[role="button"]')].filter(vis);
  const pick=btns.find(b=>/use only necessary|only necessary|necessary only|reject all|decline/i.test(b.textContent||''))||btns.find(b=>ctx(b)&&/^\\s*(accept|allow|agree|ok|got it|אישור|מאשר|הבנתי|סגור|אשר|קיבלתי)\\s*$/i.test(b.textContent||''));
  if(pick){pick.click();window.ReactNativeWebView.postMessage('probe:'+JSON.stringify({why:'consent dismissed',label:(pick.textContent||'').trim().slice(0,40)}));}}catch(e){}})();true;`;

/** What the signed-in check sees: page URL, the orders request's status and final URL, and whether the page looks logged in. */
export const PROBE_JS = `(async()=>{try{
  const out={href:location.href,title:document.title};
  // Every same-origin API call the page has made so far - the map of the store's real endpoints.
  // Same-origin paths and cross-origin API hosts alike: the shared platform keeps its API on another host.
  out.api=[...new Set(performance.getEntriesByType('resource').map(e=>e.name).filter(u=>/\\/api\\/|\\/rest\\/|graphql|json|my-account|order|cart|history|user|auth|login|session|customer|token/i.test(u)&&!/google|facebook|datadog|analytics|gtm|hotjar|cloudflare|\\.(png|jpe?g|svg|woff2?|css)(\\?|$)/i.test(u)).map(u=>u.replace(/^https?:\\/\\//,'').replace(location.host,'').slice(0,150)))].slice(0,40);
  if(location.hostname.includes('shufersal')){const r=await fetch('/online/he/my-account/orders',{credentials:'include'});const t=await r.text();Object.assign(out,{status:r.status,url:r.url,len:t.length,loginInPage:/login|התחבר|כניסה/i.test(t.slice(0,6000)),logoutLink:!!document.querySelector('a[href*="logout"]')});}
  out.bodyHead=document.body?document.body.innerText.slice(0,240).replace(/\\s+/g,' '):'';
  out.header=((document.querySelector('header')||{}).innerText||'').slice(0,200).replace(/\\s+/g,' ');
  try{const n=window.$nuxt;out.nuxt=!!n;out.authLoggedIn=n&&n.$auth?n.$auth.loggedIn:undefined;out.storeAuth=n&&n.$store&&n.$store.state&&n.$store.state.auth?Object.keys(n.$store.state.auth).slice(0,10):undefined;}catch(e){out.nuxtErr=String(e);}
  try{out.ls=Object.keys(localStorage).slice(0,20);}catch(e){}
  try{out.cookieNames=document.cookie.split(';').map(c=>c.trim().split('=')[0]).filter(Boolean).slice(0,20);}catch(e){}
  window.ReactNativeWebView.postMessage('probe:'+JSON.stringify(out));
}catch(e){window.ReactNativeWebView.postMessage('probe:'+JSON.stringify({error:String(e),href:location.href}));}})();true;`;

/**
 * Injected into the logged-in Shufersal WebView: pull recent orders through
 * the same-origin session and post them back.
 *
 * Shufersal's storefront has shipped several shapes for the orders JSON, so
 * the script reads every one it has seen (closedOrders / orders / results /
 * data; entries / orderEntries / lines; product.ean / barcode / code) and
 * falls back gracefully. It always posts a small `diag` alongside the orders
 * — the HTTP status, the top-level keys it found, and how many orders it
 * read — so a run that finds nothing tells us exactly why instead of
 * silently doing nothing.
 */
export const HISTORY_JS = `(async()=>{let diagHtml;try{
  const H={accept:'application/json','x-requested-with':'XMLHttpRequest'};
  const j=async(u)=>{const r=await fetch(u,{credentials:'include',headers:H});const t=await r.text();try{return {s:r.status,d:JSON.parse(t)}}catch(e){return {s:r.status,d:null,h:t.slice(0,400)}}};
  const L=await j('/online/he/my-account/orders');
  const root=(L.d&&typeof L.d==='object')?L.d:{};
  let arr=root.closedOrders||root.orders||root.results||root.data||root.orderHistory||[];
  if(arr&&!Array.isArray(arr)&&Array.isArray(arr.orders))arr=arr.orders;
  if(arr&&!Array.isArray(arr)&&Array.isArray(arr.results))arr=arr.results;
  if(!Array.isArray(arr))arr=[];
  const codes=arr.slice(0,20).map(o=>({code:o.code||o.orderCode||o.orderNumber||o.id||o.number,at:o.placed||o.created||o.date||o.orderDate||''})).filter(o=>o.code);
  const out=[];
  for(const o of codes){
    const D=await j('/online/he/my-account/orders/'+encodeURIComponent(o.code));
    const d=(D.d&&typeof D.d==='object')?D.d:{};
    const ents=d.entries||d.orderEntries||d.lines||d.items||(d.order&&(d.order.entries||d.order.lines))||[];
    const lines=(Array.isArray(ents)?ents:[]).map(e=>{const p=e.product||e;const n=p.name||p.productName||p.title||e.name;const c=p.ean||p.barcode||p.gtin||p.code||e.code;return n?{name:String(n),code:c?String(c):undefined,qty:Number(e.quantity||e.qty||1)||1}:null}).filter(x=>x&&!/משלוח|דמי/.test(x.name));
    if(lines.length)out.push({at:o.at,lines});
  }
  let via='json';
  if(out.length===0){
    // Fallback: the storefront is SAP Hybris; read the account pages as HTML.
    via='html';
    const html=async(u)=>{const r=await fetch(u,{credentials:'include'});return {s:r.status,t:await r.text()}};
    const P=new DOMParser();
    const list=await html('/online/he/my-account/orders?pageSize=20');
    const doc=P.parseFromString(list.t,'text/html');
    const links=[...doc.querySelectorAll('a[href*="/my-account/order"]')].map(a=>a.getAttribute('href')||'');
    const seen=new Set();const ocodes=[];
    for(const h of links){const m=h.match(/order[s]?\\/([A-Za-z0-9_-]+)/);if(m&&!seen.has(m[1])){seen.add(m[1]);ocodes.push({code:m[1],href:h});}}
    for(const o of ocodes.slice(0,20)){
      const d=await html(o.href.startsWith('http')?o.href:o.href.startsWith('/')?o.href:'/online/he/my-account/orders/'+o.code);
      const od=P.parseFromString(d.t,'text/html');
      const at=(od.querySelector('time')||{}).getAttribute?(od.querySelector('time').getAttribute('datetime')||od.querySelector('time').textContent||''):'';
      const rows=[...od.querySelectorAll('[data-product-code],[data-code],.productItem,.product-item,.cart-item,li.item,tr.item,.orderEntry,.entry')];
      const lines=[];
      for(const r of rows){
        const code=r.getAttribute('data-product-code')||r.getAttribute('data-code')||((r.querySelector('a[href*="/p/"]')||{}).getAttribute?(r.querySelector('a[href*="/p/"]').getAttribute('href')||'').match(/\\/p\\/P?_?(\\d{8,14})/)?.[1]:'')||'';
        const nameEl=r.querySelector('.name,.productName,.product-name,.title,a[href*="/p/"],h3,h4');
        const name=(nameEl?nameEl.textContent:r.textContent||'').replace(/\\s+/g,' ').trim().slice(0,80);
        const qEl=r.querySelector('.qty,.quantity,[data-qty],input[name*="qty" i]');
        const qty=Number(qEl?(qEl.value||qEl.getAttribute('data-qty')||qEl.textContent||'').replace(/[^\\d.]/g,''):1)||1;
        if(name&&name.length>2&&!/משלוח|דמי/.test(name))lines.push({name,code:code||undefined,qty});
      }
      if(lines.length)out.push({at,lines});
    }
    diagHtml={listStatus:list.s,orderLinks:ocodes.length,listTitle:(doc.querySelector('title')||{}).textContent||'',login:/login|התחבר/i.test(list.t.slice(0,4000))};
  }
  const diag={via,status:L.s,keys:Object.keys(root).slice(0,12),html:!!L.h,htmlHead:L.h?L.h.slice(0,120):undefined,found:codes.length,orders:out.length,...(typeof diagHtml!=='undefined'?{fallback:diagHtml}:{})};
  window.ReactNativeWebView.postMessage('history:'+JSON.stringify({orders:out,diag}));
}catch(e){window.ReactNativeWebView.postMessage('history:'+JSON.stringify({orders:[],diag:{error:String(e)}}));}})();true;`;
