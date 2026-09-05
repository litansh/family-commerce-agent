/**
 * Strings and direction.
 *
 * The language follows the household's region, falling back to the device.
 * Direction follows the language. Every screen reads `dir()` for alignment
 * and row order rather than hard-coding right-to-left, so a US household
 * gets a left-to-right app from the same components.
 */
import { getLocales } from 'expo-localization';
import { formatMoney, regionOf, type Currency, type Locale, type Region } from '@fca/domain';

type Strings = Record<string, string>;

const he: Strings = {
  appName: 'קנילי', tagline: 'רשימה אחת לכולם. השוואה בין כל הרשתות שמגיעות אליכם. וזיכרון של מה שאתם באמת קונים — כדי שלא תשכחו כלום.',
  continueGoogle: 'המשך עם Google', continueEmail: 'המשך עם אימייל', cancelled: 'ההתחברות בוטלה',
  household: 'משק הבית', householdSub: 'הרשימה, הכתובת והזיכרון שייכים למשפחה — לא לאדם אחד.',
  newFamily: 'משפחה חדשה', namePh: 'שם — למשל: משפחת שמיר', addressPh: 'כתובת למשלוח — רחוב, מספר, עיר', country: 'מדינה',
  create: 'צור משק בית', haveFamily: 'יש לכם כבר משפחה?', askCode: 'בקשו קוד הזמנה ממי שיצר אותה.', codePh: 'קוד הזמנה', join: 'הצטרף',
  invite: 'הזמנת בן משפחה', inviteMsg: 'קוד הזמנה למשפחה: {code} (תקף 7 ימים)', inviteTitle: 'הזמנה',
  searching: 'מחפשים…', noResults: 'לא נמצא — נוסיף כמו שכתבתם', addAsTyped: 'הוסף ״{q}״ כמו שכתבתם', pickThis: 'זה', confirmed: 'נשמר בזיכרון ✓', tapToFix: 'הקישו על פריט כדי לבחור מוצר מדויק',
  scan: 'סריקה', scanHint: 'כוונו את המצלמה לברקוד', cameraNeeded: 'צריך גישה למצלמה כדי לסרוק ברקודים', allowCamera: 'אפשר מצלמה', scanned: 'נסרק — מחפשים…',
  usuals: 'הרגילים שלכם', usualsHint: 'הקישו כדי להוסיף. הכתום — הגיע הזמן.', qty: 'כמות',
  forgot: 'שכחתם משהו?', forgotSub: 'דברים שאתם קונים בדרך כלל ולא ברשימה. הקישו להוספה.', everyDays: 'כל ~{n} ימים · לפני {d}', boughtTimes: 'נקנה {n}×',
  emptyTitle: 'הרשימה ריקה', emptyHint: 'כתבו מה צריך — למשל ״חלב 3%״ או ״פמפרס מידה 4״. אפשר לציין מותג אם זה חשוב.',
  whatPh: 'מה צריך?', brandPh: 'מותג', add: 'הוסף {q}', compare: 'השוואת מחירים', compareN: 'השוו {n} פריטים בכל הרשתות',
  comparing: 'משווים…', comparingSub: '{n} פריטים בכל הרשתות שמגיעות ל{addr}', about20s: 'בערך 20 שניות', wentWrong: 'משהו השתבש',
  howToBuy: 'איך לקנות?', optionsSub: '{n} פריטים · {m} זוהו מהזיכרון המשפחתי', spread: ' · פער של {x} בין הרשתות',
  noneCover: 'אף רשת לא מצליחה לספק מספיק מהרשימה. נסו לשנות פריטים.', best: 'הכי משתלם', items: 'פריטים', delivery: 'משלוח', timeSeparate: 'זמן (מוצג בנפרד)',
  unavailable: 'לא זמין: {x}', coverage: 'כיסוי {p}%', subs: '{n} תחליפים', confirmOnce: 'כדאי לאשר פעם אחת',
  confirmOnceSub: 'המחיר של הפריטים האלה משתנה מאוד בין רשתות — כנראה זוהו כמוצרים שונים. אישור ברקוד אחד מתקן את זה לתמיד.',
  notOffered: 'לא הוצעו — לא מספקות מספיק מהרשימה', estTotal: 'סה״כ משוער', payAtStore: 'התשלום נעשה באתר הרשת. אנחנו מכינים — אתם מאשרים.',
  open: 'פתח ›', done: 'סיימתי — תזכרו את הקנייה הזו', learnsOnly: 'הזיכרון לומד רק מקנייה שהושלמה.', back: '‹ חזרה', loadingHousehold: 'טוענים את משק הבית…',
  noPricing: 'השוואת מחירים עדיין לא זמינה ב{country}. הרשימה המשותפת והזיכרון עובדים כבר עכשיו.',
  reason_cheapest: 'הסל השלם הזול ביותר מרשת אחת', reason_verified: 'רשת אחת, תנאי משלוח מאומתים', reason_split: '{n} פריטים זולים יותר ב{brand}, והחיסכון מכסה משלוח שני',
  reason_pickupCheaper: 'איסוף עצמי — זול מכל משלוח', reason_pickup: 'איסוף עצמי — יקר יותר ממשלוח כאן', reason_drive: 'זול יותר בחנות, והחיסכון מכסה את הנסיעה',
  rej_partial: 'מספקת רק {a} מתוך {b} פריטים', rej_min: 'הסל מתחת למינימום ההזמנה',
};

const en: Strings = {
  appName: 'Kanili', tagline: 'One list for the whole family. Every store that delivers to you, compared. And a memory of what you actually buy — so nothing gets forgotten.',
  continueGoogle: 'Continue with Google', continueEmail: 'Continue with email', cancelled: 'Sign-in was cancelled',
  household: 'Your household', householdSub: 'The list, the address and the memory belong to the family — not to one person.',
  newFamily: 'New family', namePh: 'Name — e.g. The Shamirs', addressPh: 'Delivery address — street, number, city', country: 'Country',
  create: 'Create household', haveFamily: 'Already have a family?', askCode: 'Ask whoever created it for an invite code.', codePh: 'Invite code', join: 'Join',
  invite: 'Invite family', inviteMsg: 'Family invite code: {code} (valid 7 days)', inviteTitle: 'Invite',
  searching: 'Searching…', noResults: 'No match — add it as typed', addAsTyped: 'Add “{q}” as typed', pickThis: 'This one', confirmed: 'Saved to memory ✓', tapToFix: 'Tap an item to pick the exact product',
  scan: 'Scan', scanHint: 'Point the camera at a barcode', cameraNeeded: 'Camera access is needed to scan barcodes', allowCamera: 'Allow camera', scanned: 'Scanned — looking it up…',
  usuals: 'Your usuals', usualsHint: 'Tap to add. Amber means it is about due.', qty: 'Qty',
  forgot: 'Forgot something?', forgotSub: 'Things you usually buy that are not on the list. Tap to add.', everyDays: 'every ~{n} days · {d} days ago', boughtTimes: 'bought {n}×',
  emptyTitle: 'Your list is empty', emptyHint: 'Type what you need — “milk 3%”, “Pampers size 4”. Add a brand if it matters.',
  whatPh: 'What do you need?', brandPh: 'Brand', add: 'Add {q}', compare: 'Compare prices', compareN: 'Compare {n} items across every store',
  comparing: 'Comparing…', comparingSub: '{n} items across every store delivering to {addr}', about20s: 'About 20 seconds', wentWrong: 'Something went wrong',
  howToBuy: 'How to buy?', optionsSub: '{n} items · {m} resolved from family memory', spread: ' · {x} spread between stores',
  noneCover: 'No store can supply enough of this list. Try changing items.', best: 'Best value', items: 'items', delivery: 'delivery', timeSeparate: 'Time (shown separately)',
  unavailable: 'Unavailable: {x}', coverage: '{p}% coverage', subs: '{n} substitutions', confirmOnce: 'Worth confirming once',
  confirmOnceSub: 'These items vary a lot in price between stores — probably matched to different products. Confirming a barcode once fixes it for good.',
  notOffered: 'Not offered — cannot supply enough of the list', estTotal: 'Estimated total', payAtStore: 'Payment happens on the store’s site. We prepare — you approve.',
  open: 'Open ›', done: 'Done — remember this shop', learnsOnly: 'Memory learns only from completed shops.', back: '‹ Back', loadingHousehold: 'Loading your household…',
  noPricing: 'Price comparison is not available in {country} yet. The shared list and memory work today.',
  reason_cheapest: 'Cheapest complete basket from one store', reason_verified: 'One store, verified delivery terms', reason_split: '{n} items are cheaper at {brand}, and the saving clears a second delivery fee',
  reason_pickupCheaper: 'Collect yourself — cheaper than any delivery', reason_pickup: 'Collect yourself — costs more than delivery here', reason_drive: 'Cheaper in store, and the saving clears the drive',
  rej_partial: 'supplies only {a} of {b} items', rej_min: 'basket is below the store minimum',
};

const TABLES: Partial<Record<Locale, Strings>> = { he, en };

let region: Region = regionOf(getLocales()[0]?.regionCode ?? undefined);

/** Called once the household is known; before that, the device decides. */
export function setRegion(r: Region): void { region = r; }
export function currentRegion(): Region { return region; }
export const dir = (): 'rtl' | 'ltr' => (region.rtl ? 'rtl' : 'ltr');
export const isRTL = (): boolean => region.rtl;
export const money = (minor: number, currency: Currency = region.currency): string => formatMoney(minor, currency);

export function t(key: string, vars: Record<string, string | number> = {}): string {
  const table = TABLES[region.locale] ?? en;
  let s = table[key] ?? en[key] ?? key;
  for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

/** Hebrew for the domain's machine-readable reasons, or English when the app is English. */
export function reasonT(reason: string): string {
  if (reason.startsWith('Cheapest complete basket')) return t('reason_cheapest');
  if (reason.startsWith('Single retailer with verified')) return t('reason_verified');
  if (reason.includes('cheaper at') && reason.includes('second delivery')) {
    return t('reason_split', { n: /^(\d+) lines/.exec(reason)?.[1] ?? '', brand: /cheaper at (.+?),/.exec(reason)?.[1] ?? '' });
  }
  if (reason.startsWith('Collect yourself — cheaper')) return t('reason_pickupCheaper');
  if (reason.startsWith('Collect yourself')) return t('reason_pickup');
  if (reason.startsWith('Cheaper in store')) return t('reason_drive');
  return reason;
}
export function rejectionT(reason: string): string {
  const m = /prices only (\d+)\/(\d+) lines/.exec(reason);
  if (m) return t('rej_partial', { a: m[1]!, b: m[2]! });
  if (reason.includes('below the storefront minimum')) return t('rej_min');
  return reason;
}
