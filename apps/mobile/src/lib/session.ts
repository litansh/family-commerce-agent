/**
 * A store's session, as the store's own page can read it (ADR 0008).
 *
 * Scripts injected into the store's WebView, shared by the connect screen
 * (StoreLink), the hidden keep-alive (SessionKeeper) and the labs, so what the
 * phone captures is one thing, proven in one place:
 *
 *   GUARD_JS          '' | 'challenge' | 'blocked' — a Cloudflare step is the person's to click,
 *                     nothing runs while it is on screen.
 *   signedInPollJs    the store's own signed-in check, posted as `signedin:1|0`.
 *   captureSessionJs  the cookies the page can read (never HttpOnly ones) and the
 *                     localStorage / sessionStorage tokens that make the session, posted as
 *                     `<tag>:{cookies,tokens,userAgent,diag}` — always, even when empty or on
 *                     an error, so a phone that captured nothing says so in the log.
 *
 * Plain strings evaluated inside the WebView: no `\/` escapes, no top-level `return`.
 */
import type { StoreDef } from './stores';

export interface CapturedCookie { readonly name: string; readonly value: string; readonly domain?: string; readonly path?: string }
export interface CapturedSession {
  readonly cookies: CapturedCookie[];
  /** localStorage entries; a sessionStorage entry is keyed `ss:<name>`. */
  readonly tokens: Record<string, string>;
  readonly userAgent?: string;
  /** Names only, never values: what the page had, what was taken, what was too big. */
  readonly diag: { readonly href?: string; readonly cookieNames?: readonly string[]; readonly lsKeys?: readonly string[]; readonly ssKeys?: readonly string[]; readonly skipped?: readonly string[]; readonly error?: string };
}

/** How much of the store's storage rides to the cloud: one value, and all of them together. */
export const MAX_TOKEN_CHARS = 8192;
export const MAX_SESSION_CHARS = 60_000;

export const GUARD_JS = `(()=>{try{const t=(document.title+' '+((document.body&&document.body.innerText)||'').slice(0,600));if(/Sorry, you have been blocked|Error 1020|Access denied|has been blocked/i.test(t))return 'blocked';if(document.querySelector('#challenge-form,#challenge-running,#challenge-stage,#challenge-error-text,.cf-turnstile,[id^="cf-chl"],iframe[src*="challenges.cloudflare.com"]')||/cdn-cgi\\/challenge/.test(location.href)||/Just a moment|Attention Required|Verify you are human|Checking your browser|אימות אנושי/i.test(t))return 'challenge';}catch(e){}return '';})()`;

/**
 * One look at the store's own signed-in answer. Posts `guard:<state>` first; while a code box is on
 * screen it answers `signedin:0` without running the check (Shufersal's check fetches /my-account,
 * which redirects and can disturb the OTP page).
 */
export const signedInPollJs = (store: Pick<StoreDef, 'signedInCheck'>): string =>
  `(async()=>{try{const g=${GUARD_JS};window.ReactNativeWebView.postMessage('guard:'+g);if(g)return;if(document.querySelector('input[autocomplete="one-time-code"]')){window.ReactNativeWebView.postMessage('signedin:0');return;}const ok=await (${store.signedInCheck});window.ReactNativeWebView.postMessage('signedin:'+(ok?'1':'0'));}catch(e){window.ReactNativeWebView.postMessage('signedin:0');}})();true;`;

/**
 * Read the session the page holds and post it. Cookies: everything document.cookie shows, with
 * the page's host as the domain. Tokens: localStorage (and sessionStorage, as `ss:<name>`) entries
 * the store names in `sessionKeys`, or whose name says token / jwt / auth — Rami Levy's nuxt-auth
 * keeps `auth._token.local` in both places, Wolt's `__wrtoken` is a cookie, Hatzi Hinam's bearer is
 * `access_token`. A value over MAX_TOKEN_CHARS (Rami Levy's 290 KB persisted vuex blob) is named
 * in `diag.skipped` and left behind; it is state, not the session.
 */
export const captureSessionJs = (store: Pick<StoreDef, 'sessionKeys'>, tag = 'session'): string =>
  `(()=>{const out={cookies:[],tokens:{},userAgent:navigator.userAgent,diag:{}};try{
  const keys=${JSON.stringify(store.sessionKeys ?? [])};const MAXV=${MAX_TOKEN_CHARS},MAXT=${MAX_SESSION_CHARS};
  out.diag.href=location.href;
  const cs=document.cookie.split(';').map(c=>c.trim()).filter(Boolean);
  out.diag.cookieNames=cs.map(c=>c.split('=')[0]).slice(0,40);
  for(const c of cs){const i=c.indexOf('=');if(i<=0)continue;let v=c.slice(i+1);try{v=decodeURIComponent(v);}catch(e){}out.cookies.push({name:c.slice(0,i),value:v,domain:location.hostname,path:'/'});}
  const wanted=(k)=>keys.includes(k)||/token|jwt|auth[._-]/i.test(k);
  let total=0;out.diag.skipped=[];
  const takeFrom=(st,prefix,into)=>{const names=[];try{for(let i=0;i<st.length;i++){const k=st.key(i);if(k==null)continue;names.push(k);if(!wanted(k))continue;const v=st.getItem(k);if(v==null||v.length<2)continue;if(v.length>MAXV||total+v.length>MAXT){out.diag.skipped.push(prefix+k+':'+v.length);continue;}out.tokens[prefix+k]=v;total+=v.length;}}catch(e){out.diag.skipped.push(prefix+'!'+String(e).slice(0,60));}into.push(...names.slice(0,40));};
  out.diag.lsKeys=[];takeFrom(window.localStorage,'',out.diag.lsKeys);
  out.diag.ssKeys=[];takeFrom(window.sessionStorage,'ss:',out.diag.ssKeys);
  }catch(e){out.diag.error=String(e).slice(0,200);}
  window.ReactNativeWebView.postMessage(${JSON.stringify(tag + ':')}+JSON.stringify(out));})();true;`;

/** Parse what captureSessionJs posted (the part after `<tag>:`); a malformed report is an empty one with the error named. */
export function parseCapturedSession(json: string): CapturedSession {
  try {
    const got = JSON.parse(json) as Partial<CapturedSession>;
    const cookies = (Array.isArray(got.cookies) ? got.cookies : []).filter((c) => c && typeof c.name === 'string' && typeof c.value === 'string');
    const tokens = Object.fromEntries(Object.entries(got.tokens && typeof got.tokens === 'object' ? got.tokens : {}).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
    return { cookies, tokens, ...(typeof got.userAgent === 'string' ? { userAgent: got.userAgent } : {}), diag: got.diag && typeof got.diag === 'object' ? got.diag : {} };
  } catch (e) {
    return { cookies: [], tokens: {}, diag: { error: `bad session report: ${String(e).slice(0, 120)}` } };
  }
}

/** Counts for the log — never a value. */
export const sessionSummary = (s: CapturedSession): { cookies: number; tokens: number; cookieNames: readonly string[]; tokenNames: string[]; skipped: readonly string[]; error?: string } => ({
  cookies: s.cookies.length, tokens: Object.keys(s.tokens).length, cookieNames: s.diag.cookieNames ?? s.cookies.map((c) => c.name), tokenNames: Object.keys(s.tokens), skipped: s.diag.skipped ?? [], ...(s.diag.error ? { error: s.diag.error } : {}),
});

/**
 * Whether a capture actually holds the store's own session, not just decorative cookies -
 * analytics/ad ids (`_ga`, `AWSALB`, …) are on every page, signed in or not, so `cookies>0` alone
 * is never proof. Checked against the names the store itself keeps its session in
 * (`StoreDef.sessionKeys`); a store with none named falls back to "captured anything at all".
 */
export function hasAuthSession(s: CapturedSession, sessionKeys: readonly string[] | undefined): boolean {
  const keys = sessionKeys ?? [];
  if (keys.length === 0) return s.cookies.length > 0 || Object.keys(s.tokens).length > 0;
  return keys.some((k) => s.cookies.some((c) => c.name === k) || k in s.tokens);
}
