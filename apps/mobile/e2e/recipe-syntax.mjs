/**
 * Every store's on-device cart recipe must be valid JavaScript, or it fails
 * silently inside the WebView. This guards against escaping mistakes in the
 * generated strings (a double-escaped regex once became a line comment).
 *
 *   node --experimental-strip-types e2e/recipe-syntax.mjs
 */
import { STORES } from '../src/lib/stores.ts';
import { captureSessionJs, GUARD_JS, signedInPollJs } from '../src/lib/session.ts';
import { CONSENT_JS, guardedJs, HISTORY_JS, OTP_JS, PROBE_JS } from '../src/lib/inject.ts';
const sample = [{ gtin: '7290004131074', name: 'x', qty: 2 }, { gtin: '1', name: 'y', qty: 1 }];
let bad = 0;
// The connect screen's and the keeper's own scripts first: the Cloudflare guard once carried a
// `\/` that made it an invalid regex, and with it every guarded injection failed silently.
for (const [label, js] of [['GUARD_JS', `(()=>{return (${GUARD_JS});})`], ['guardedJs', guardedJs('1;')], ['OTP_JS', OTP_JS], ['CONSENT_JS', CONSENT_JS], ['PROBE_JS', PROBE_JS], ['HISTORY_JS', HISTORY_JS]]) {
  try { new Function(js); } catch (e) { bad++; console.log(`${label}: ${String(e).slice(0, 90)}`); }
}
for (const id of Object.keys(STORES)) {
  const st = STORES[id];
  for (const [label, js] of [['cartJs', st.cartJs?.(sample)], ['openLoginJs', st.openLoginJs], ['prefillEmailJs', st.prefillEmailJs?.('a@b.c')], ['forgotJs', st.forgotJs], ['historyJs', st.historyJs], ['signedInCheck', st.signedInCheck && `(async()=>{return (${st.signedInCheck});})`], ['signedInPollJs', signedInPollJs(st)], ['captureSessionJs', captureSessionJs(st)], ['guarded openLoginJs', st.openLoginJs && guardedJs(st.openLoginJs)]]) {
    if (!js) continue;
    try { new Function(js); } catch (e) { bad++; console.log(`${id}.${label}: ${String(e).slice(0, 90)}`); }
  }
}
console.log(bad ? `\n${bad} broken recipe(s)` : 'all store recipes parse');
process.exit(bad ? 1 : 0);
