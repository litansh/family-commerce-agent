/**
 * Strings and direction.
 *
 * The language follows the household's region, falling back to the device.
 * Direction follows the language. Every screen reads `dir()` for alignment
 * and row order rather than hard-coding right-to-left, so a US household
 * gets a left-to-right app from the same components.
 */
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { formatMoney, regionOf, type Currency, type Locale, type Region } from '@fca/domain';

type Strings = Record<string, string>;

const he: Strings = {
  appName: 'קנילי', tagline: 'רשימה אחת לכולם. השוואה בין כל הרשתות שמגיעות אליכם. וזיכרון של מה שאתם באמת קונים — כדי שלא תשכחו כלום.',
  continueGoogle: 'המשך עם Google', continueEmail: 'כניסה', signUp: 'הרשמה — חשבון חדש', orDivider: 'או', cancelled: 'ההתחברות בוטלה',
  household: 'משק הבית', householdSub: 'הרשימה, הכתובת והזיכרון שייכים למשפחה — לא לאדם אחד.',
  newFamily: 'משפחה חדשה', namePh: 'שם — למשל: משפחת שמיר', country: 'מדינה',
  create: 'צור משק בית', haveFamily: 'יש לכם כבר משפחה?', askCode: 'בקשו קוד הזמנה ממי שיצר אותה.', codePh: 'קוד הזמנה', join: 'הצטרף',
  invite: 'הזמנת בן משפחה', inviteMsg: 'קוד הזמנה למשפחה: {code} (תקף 7 ימים)', inviteTitle: 'הזמנה',
  searching: 'מחפשים…', noResults: 'לא נמצא — נוסיף כמו שכתבתם', addAsTyped: 'הוסף ״{q}״ כמו שכתבתם', pickThis: 'זה', confirmed: 'נשמר בזיכרון ✓', tapToFix: 'הקישו על פריט כדי לבחור מוצר מדויק',
  orderViaKanili: 'הזמינו דרך קנילי', orderTitle: 'ההזמנה שלכם', orderConnecting: 'מתחברים…', approveTitle: 'לאשר את ההזמנה?', approveSub: 'זה הסכום האמיתי מדף הסיכום של הרשת. שום דבר לא מחויב עד שתאשרו.',
  realTotal: 'סה״כ לתשלום', slot: 'משלוח', payment: 'תשלום', approvePay: 'אשרו ושלמו {x}', cancel: 'ביטול', placedTitle: 'ההזמנה בוצעה ✓', placedSub: 'מספר הזמנה אצל הרשת: {id}', failedTitle: 'ההזמנה לא הושלמה', failedSub: 'לא חויבתם. אפשר לנסות שוב או להזמין ישירות מהקישורים.',
  workerNote: 'קנילי ממלאת את העגלה אצל הרשת עכשיו. זה לוקח דקה-שתיים.', noWorker: 'כדי להזמין דרך קנילי צריך לחבר את חשבון הרשת פעם אחת במחשב הבית.',
  status_queued: 'בתור', status_connecting: 'מתחברים לרשת', status_filling_cart: 'ממלאים את העגלה', status_choosing_slot: 'בוחרים חלון משלוח', status_awaiting_approval: 'מחכים לאישור שלכם', status_approved: 'אושר', status_placing: 'מבצעים את ההזמנה', status_placed: 'ההזמנה בוצעה', status_cancelled: 'בוטל', status_failed: 'נכשל',
  usualShop: 'הוסיפו את הקנייה הרגילה', usualShopN: 'הוסיפו את הקנייה הרגילה · {n} פריטים', addedN: 'נוספו {n} פריטים', added: 'נוסף', otherWays: 'דרכים אחרות לקנות', bestWay: 'הדרך הכי טובה לקנות',
  orderNow: 'הזמינו דרך קנילי · {x}', linksInstead: 'או קנו לבד עם קישורים', taglineShort: 'כל הסופרים. חנות אחת.', taglineLong: 'רשימה אחת, סל אחד, כל הרשתות — ושום דבר לא נשכח.',
  whereOrder: 'איפה אתם בדרך כלל מזמינים?', whereOrderHint: 'בחרו את הרשתות. קנילי תתחבר אליהן ותלמד מה אתם קונים.', howGet: 'איך נוח לכם לקבל?', delivery_: 'משלוח', pickup_: 'איסוף עצמי', either_: 'מה שזול יותר',
  connectedStoresSub: 'חברו חנות פעם אחת — כניסה מהירה, וקנילי מזמינה בשבילכם.', connect: 'חברו', disconnect: 'נתקו',
  linkTipPw: 'שימו לב: כניסת ״חברי מועדון״ נותנת רק מחירי מועדון ולא מאפשרת הזמנה. להזמנה — התחברו עם אימייל+סיסמה (Face ID ימלא) או ״התחבר עם פייסבוק״.', linkTipOtp: 'הזינו מספר טלפון וקוד ה-SMS — בלי סיסמה.',
  connectStore: 'חיבור {s}', linkHintOtp: 'היכנסו ל{s} עם הטלפון וקוד ה-SMS — בלי סיסמה.', linkHintPw: 'היכנסו ל{s}. הסיסמה נשמרת באייפון — Face ID ימלא אותה.', imSignedIn: 'התחברתי', linkedSub: 'החשבון ב{s} מחובר. מכאן קנילי מזמינה בשבילכם.', linkNeedsApp: 'חיבור חנות נעשה באפליקציה בטלפון, שם המכשיר ממלא את הפרטים אוטומטית.', linkPrivacy: 'ההתחברות נשארת במכשיר שלכם. קנילי לא שומרת סיסמאות.', ok: 'הבנתי', addStore: 'חיבור חנות',
  connectTitle: 'חברו את {r} ולמדו מההיסטוריה', connectSub: 'פעם אחת, במחשב הבית: הריצו את הפקודה, ובחלון שנפתח היכנסו עם קוד ב-SMS — בלי סיסמה. קנילי שומרת את החיבור וקוראת את ההזמנות הקודמות שלכם.', importBtn: 'ייבאו את ההזמנות הקודמות', importing: 'קוראים את ההיסטוריה…', importDone: 'נלמדו {o} הזמנות · {p} מוצרים', importFailed: 'הייבוא נכשל: {e}', importNeedsLink: 'קודם צריך לחבר את החשבון במחשב הבית.',
  tabHome: 'בית', tabList: 'רשימה', tabOrders: 'הזמנות', tabMe: 'אני', hello: 'שלום, {n}', aisles: 'המחלקות', browseAisle: 'לכל המוצרים ›', addToList: 'הוסף', inList: 'ברשימה ✓', from: 'החל מ', atChains: 'ב-{n} רשתות',
  ordersTitle: 'ההזמנות שלכם', noOrders: 'עדיין אין הזמנות. הרשימה הראשונה מחכה.', meTitle: 'משק הבית', members: 'בני משפחה', inviteCode: 'קוד הזמנה', signOut: 'התנתקות', yourStores: 'הרשתות שלכם', getIt: 'איך מקבלים', workerOffline: 'המחשב הבית לא מחובר עכשיו — ההזמנה תמתין בתור עד שיתחבר.',
  skip: 'דלגו', introNext: 'הבא', introStart: 'מתחילים',
  intro1Title: 'כל הסופרים. חנות אחת.', intro1Body: 'שופרסל, רמי לוי, ויקטורי, קרפור… קנילי משווה את הסל שלכם בכולן ומזמינה מהמקום שמשתלם — ואתם מאשרים פעם אחת.', intro1Tap: 'הקישו כדי לראות איך זה עובד', intro1Done: 'סל אחד. הזמנה אחת. כל הרשתות. ✓',
  intro2Title: 'קנילי לומדת מה אתם קונים', intro2Body: 'הקישו על מה שקונים אצלכם בבית. זה בדיוק מה שקנילי זוכרת — מותג, כמות, וכל כמה זמן.', intro2Memory: 'הזיכרון המשפחתי', intro2Empty: 'עדיין ריק — הקישו למעלה', intro2Usual: 'ככה נראית "הקנייה הרגילה" שלכם: {n} פריטים בהקשה אחת.',
  intro3Title: 'שום דבר לא נשכח', intro3Body: 'קנילי יודעת שחלב נגמר כל ~4 ימים. כשמגיע הזמן — היא מזכירה, לפני שקונים ביוקר במכולת.', intro3Days: 'לפני {d} ימים', intro3Due: 'הגיע הזמן לחלב — נוסיף?', intro3Rhythm: 'לומדים את הקצב…',
  introAfter: 'המסך הבא לוקח דקה: כתובת, הרשתות שלכם, ואיך נוח לכם לקבל.',
  introTryFirst: '↑ נסו את זה למעלה כדי להמשיך', intro3Added: 'נוסף לרשימה ✓',
  intro4Title: 'שלוש הקשות', intro4Body: 'ככה נראית קנייה שבועית בקנילי. נסו:', intro4a: 'הוסיפו את הקנייה הרגילה', intro4b: 'השוו בכל הרשתות', intro4c: 'אשרו את הסכום', intro4Done: 'זהו. המצרכים בדרך. 🛒',
  couponChip: 'קופון −{x}', connectedStores: 'החנויות המחוברות', workerOnline: 'המחשב הבית מחובר', workerOff: 'המחשב הבית לא מחובר', linked: 'מחובר', notLinked: 'לא מחובר', copyCmd: 'העתיקו את הפקודה', copied: 'הועתק ✓', showIntro: 'הצג את ההקדמה שוב',
  signInTitle: 'כניסה', signUpTitle: 'יצירת חשבון', confirmTitle: 'אימות המייל', forgotTitle: 'שחזור סיסמה', resetTitle: 'סיסמה חדשה',
  email: 'אימייל', password: 'סיסמה', passwordAgain: 'הסיסמה שוב', newPassword: 'סיסמה חדשה', code: 'קוד האימות מהמייל', pwRule: 'לפחות 10 תווים, עם אות ומספר.',
  signInBtn: 'כניסה', signUpBtn: 'יצירת חשבון', confirmBtn: 'אימות', sendCode: 'שלחו לי קוד', resetBtn: 'שמירת סיסמה', noAccount: 'אין לכם חשבון? הרשמה', forgotLink: 'שכחתי סיסמה', resend: 'שלחו קוד שוב', backToSignIn: 'חזרה לכניסה', codeSent: 'שלחנו קוד ל-{e}',
  errExists: 'כבר יש חשבון עם האימייל הזה — נסו להיכנס.', errWeak: 'הסיסמה חלשה מדי: לפחות 10 תווים, עם אות ומספר.', errMismatch: 'הסיסמאות לא זהות.', errCode: 'הקוד לא נכון.', errCodeExpired: 'הקוד פג — שלחנו חדש.', errWrong: 'האימייל או הסיסמה לא נכונים.', errUnconfirmed: 'המייל עדיין לא אומת.', errLimit: 'יותר מדי ניסיונות — נסו שוב בעוד כמה דקות.',
  addressLabel: 'כתובת למשלוח', addressPh: 'רחוב ומספר, עיר — למשל: ביאליק 20 רמת גן', verified: 'מאומת', partial: 'חלקי', addressVerified: 'הכתובת אומתה', addressPartial: 'חסר מספר בית — בחרו כתובת מדויקת מהרשימה', apt: 'דירה', floor: 'קומה', entrance: 'כניסה', notesPh: 'הערות לשליח (קוד, מיקום…)', pickFromList: 'בחרו את הכתובת מהרשימה כדי להמשיך',
  boughtBefore: 'קניתם', priceAt: 'המחיר בכל רשת', cheapestHere: 'הכי זול',
  language: 'שפה',
  atNStores: 'ב-{n} רשתות', dealsTitle: 'מבצעים השבוע', dealsSub: 'ליד הבית, בכל הרשתות',
  strat_cheapest: 'הכי זול', strat_single: 'חנות אחת', strat_pickup: 'איסוף עצמי', strat_split: 'פיצול', strat_none: 'אין אפשרות כזו לסל הזה',
  whyNot: 'למה לא רשתות אחרות?', minShort: '{b}: {p} למוצרים, אבל חסרים {x} למינימום הזמנה של {m}', covShort: '{b}: מספקת רק {a} מתוך {c} פריטים', minNote: 'מינימום {m}', feeNote: 'משלוח {f}',
  nProducts: '{n} מוצרים', loadMore: 'עוד {n} מוצרים', loading: 'טוענים…', carriedBy: 'נמכר ב', pricesAtCompare: 'המחיר בכל רשת מחושב בהשוואה — על כל הסל יחד.',
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
  continueGoogle: 'Continue with Google', continueEmail: 'Sign in', signUp: 'Sign up — new account', orDivider: 'or', cancelled: 'Sign-in was cancelled',
  household: 'Your household', householdSub: 'The list, the address and the memory belong to the family — not to one person.',
  newFamily: 'New family', namePh: 'Name — e.g. The Shamirs', country: 'Country',
  create: 'Create household', haveFamily: 'Already have a family?', askCode: 'Ask whoever created it for an invite code.', codePh: 'Invite code', join: 'Join',
  invite: 'Invite family', inviteMsg: 'Family invite code: {code} (valid 7 days)', inviteTitle: 'Invite',
  searching: 'Searching…', noResults: 'No match — add it as typed', addAsTyped: 'Add “{q}” as typed', pickThis: 'This one', confirmed: 'Saved to memory ✓', tapToFix: 'Tap an item to pick the exact product',
  orderViaKanili: 'Order through Kanili', orderTitle: 'Your order', orderConnecting: 'Connecting…', approveTitle: 'Approve this order?', approveSub: 'This is the real total from the store’s review page. Nothing is charged until you approve.',
  realTotal: 'Total to pay', slot: 'Delivery', payment: 'Payment', approvePay: 'Approve and pay {x}', cancel: 'Cancel', placedTitle: 'Order placed ✓', placedSub: 'Store order number: {id}', failedTitle: 'The order did not go through', failedSub: 'You were not charged. Try again, or order directly from the links.',
  workerNote: 'Kanili is filling your cart at the store now. This takes a minute or two.', noWorker: 'To order through Kanili, link your store account once on the home computer.',
  status_queued: 'Queued', status_connecting: 'Connecting to the store', status_filling_cart: 'Filling the cart', status_choosing_slot: 'Choosing a delivery slot', status_awaiting_approval: 'Waiting for your approval', status_approved: 'Approved', status_placing: 'Placing the order', status_placed: 'Order placed', status_cancelled: 'Cancelled', status_failed: 'Failed',
  usualShop: 'Add the usual shop', usualShopN: 'Add the usual shop · {n} items', addedN: '{n} items added', added: 'Added', otherWays: 'Other ways to buy', bestWay: 'Best way to buy',
  orderNow: 'Order through Kanili · {x}', linksInstead: 'or buy yourself with links', taglineShort: 'Every store. One shop.', taglineLong: 'One list, one basket, every chain — and nothing forgotten.',
  whereOrder: 'Where do you usually order?', whereOrderHint: 'Pick your chains. Kanili connects to them and learns what you buy.', howGet: 'How do you like to get it?', delivery_: 'Delivery', pickup_: 'Pickup', either_: 'Whichever is cheaper',
  connectedStoresSub: 'Connect a store once — a quick sign-in, and Kanili orders for you.', connect: 'Connect', disconnect: 'Disconnect',
  linkTipPw: 'Note: the “club member” sign-in only gives club prices, not ordering. To order, sign in with email+password (Face ID fills it) or “Log in with Facebook”.', linkTipOtp: 'Enter your phone number and the SMS code — no password.',
  connectStore: 'Connect {s}', linkHintOtp: 'Sign in to {s} with your phone and the SMS code — no password.', linkHintPw: 'Sign in to {s}. Your password is on the iPhone — Face ID fills it.', imSignedIn: "I'm signed in", linkedSub: 'Your {s} account is connected. Kanili orders for you from here.', linkNeedsApp: 'Connecting a store happens in the phone app, where the device fills your details automatically.', linkPrivacy: 'The sign-in stays on your device. Kanili stores no passwords.', ok: 'Got it', addStore: 'Connect a store',
  connectTitle: 'Connect {r} and learn from your history', connectSub: 'Once, on the home computer: run the command and, in the window that opens, sign in with an SMS code — no password. Kanili keeps the session and reads your past orders.', importBtn: 'Import past orders', importing: 'Reading your history…', importDone: 'Learned {o} orders · {p} products', importFailed: 'Import failed: {e}', importNeedsLink: 'Link the account on the home computer first.',
  tabHome: 'Home', tabList: 'List', tabOrders: 'Orders', tabMe: 'Me', hello: 'Hi, {n}', aisles: 'Aisles', browseAisle: 'All products ›', addToList: 'Add', inList: 'In list ✓', from: 'from', atChains: 'at {n} chains',
  ordersTitle: 'Your orders', noOrders: 'No orders yet. Your first list is waiting.', meTitle: 'Household', members: 'Family', inviteCode: 'Invite code', signOut: 'Sign out', yourStores: 'Your stores', getIt: 'How you get it', workerOffline: 'The home computer is offline — the order will wait in the queue until it connects.',
  skip: 'Skip', introNext: 'Next', introStart: 'Let’s go',
  intro1Title: 'Every store. One shop.', intro1Body: 'Shufersal, Rami Levy, Victory, Carrefour… Kanili prices your basket at all of them and orders from wherever wins — you approve once.', intro1Tap: 'Tap to see how it works', intro1Done: 'One basket. One order. Every chain. ✓',
  intro2Title: 'Kanili learns what you buy', intro2Body: 'Tap what your home actually buys. That is exactly what Kanili remembers — brand, amount, and how often.', intro2Memory: 'Family memory', intro2Empty: 'Empty so far — tap above', intro2Usual: 'This is your “usual shop”: {n} items in one tap.',
  intro3Title: 'Nothing forgotten', intro3Body: 'Kanili knows milk runs out every ~4 days. When it is time, it reminds you — before you pay corner-shop prices.', intro3Days: '{d} days ago', intro3Due: 'Milk is due — add it?', intro3Rhythm: 'Learning the rhythm…',
  introAfter: 'The next screen takes a minute: your address, your stores, and how you like to get it.',
  introTryFirst: '↑ Try it above to continue', intro3Added: 'Added to the list ✓',
  intro4Title: 'Three taps', intro4Body: 'This is a weekly shop in Kanili. Try it:', intro4a: 'Add the usual shop', intro4b: 'Compare every store', intro4c: 'Approve the total', intro4Done: 'That’s it. Groceries on the way. 🛒',
  couponChip: 'Coupon −{x}', connectedStores: 'Connected stores', workerOnline: 'Home computer online', workerOff: 'Home computer offline', linked: 'Linked', notLinked: 'Not linked', copyCmd: 'Copy the command', copied: 'Copied ✓', showIntro: 'Show the intro again',
  signInTitle: 'Sign in', signUpTitle: 'Create account', confirmTitle: 'Verify your email', forgotTitle: 'Reset password', resetTitle: 'New password',
  email: 'Email', password: 'Password', passwordAgain: 'Password again', newPassword: 'New password', code: 'Verification code from email', pwRule: 'At least 10 characters, with a letter and a number.',
  signInBtn: 'Sign in', signUpBtn: 'Create account', confirmBtn: 'Verify', sendCode: 'Send me a code', resetBtn: 'Save password', noAccount: 'No account? Sign up', forgotLink: 'Forgot password', resend: 'Resend code', backToSignIn: 'Back to sign in', codeSent: 'We sent a code to {e}',
  errExists: 'There is already an account with this email — try signing in.', errWeak: 'Password too weak: at least 10 characters, with a letter and a number.', errMismatch: 'Passwords do not match.', errCode: 'Wrong code.', errCodeExpired: 'Code expired — we sent a new one.', errWrong: 'Wrong email or password.', errUnconfirmed: 'Email not verified yet.', errLimit: 'Too many attempts — try again in a few minutes.',
  addressLabel: 'Delivery address', addressPh: 'Street and number, city', verified: 'Verified', partial: 'Partial', addressVerified: 'Address verified', addressPartial: 'Missing house number — pick an exact address from the list', apt: 'Apt', floor: 'Floor', entrance: 'Entrance', notesPh: 'Notes for the courier (code, location…)', pickFromList: 'Pick the address from the list to continue',
  boughtBefore: 'Bought before', priceAt: 'Price at every store', cheapestHere: 'Cheapest',
  language: 'Language',
  atNStores: 'at {n} stores', dealsTitle: 'Deals this week', dealsSub: 'Near you, across every chain',
  strat_cheapest: 'Cheapest', strat_single: 'One store', strat_pickup: 'Pickup', strat_split: 'Split', strat_none: 'No such option for this basket',
  whyNot: 'Why not other stores?', minShort: '{b}: {p} for the items, but {x} short of the {m} minimum', covShort: '{b}: supplies only {a} of {c} items', minNote: 'min {m}', feeNote: 'delivery {f}',
  nProducts: '{n} products', loadMore: '{n} more products', loading: 'Loading…', carriedBy: 'Carried by', pricesAtCompare: 'Per-chain prices are computed at compare time — for the whole basket at once.',
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

// Israel is the product today: the country is fixed, Hebrew is the default
// for everyone, and the language is a choice the person makes and the device
// remembers.
let region: Region = { ...regionOf('IL'), locale: 'he', rtl: true };
const LANG_KEY = 'fca.lang';
const listeners = new Set<() => void>();

export type Lang = 'he' | 'en';
export const LANGS: { key: Lang; label: string }[] = [{ key: 'he', label: 'עברית' }, { key: 'en', label: 'English' }];

export function setLanguage(l: Lang): void {
  region = { ...region, locale: l, rtl: l === 'he' };
  void AsyncStorage.setItem(LANG_KEY, l).catch(() => undefined);
  for (const fn of listeners) fn();
}
export async function loadLanguage(): Promise<void> {
  try { const l = await AsyncStorage.getItem(LANG_KEY); if (l === 'he' || l === 'en') { region = { ...region, locale: l, rtl: l === 'he' }; for (const fn of listeners) fn(); } } catch { /* default stands */ }
}
/** Re-render a component when the language changes. */
export function useLanguage(): Lang {
  const [, force] = useState(0);
  useEffect(() => { const fn = () => force((n) => n + 1); listeners.add(fn); return () => { listeners.delete(fn); }; }, []);
  return region.locale === 'en' ? 'en' : 'he';
}

/** Called once the household is known; before that, the device decides. */
export function setRegion(r: Region): void { region = { ...r, locale: region.locale, rtl: region.rtl }; }
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
