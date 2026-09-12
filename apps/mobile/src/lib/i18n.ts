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
  appName: 'קניתי', tagline: 'רשימה אחת לכולם. השוואה בין כל הרשתות שמגיעות אליכם. וזיכרון של מה שאתם באמת קונים — כדי שלא תשכחו כלום.',
  continueGoogle: 'המשך עם Google', continueEmail: 'כניסה', signUp: 'הרשמה — חשבון חדש', orDivider: 'או', cancelled: 'ההתחברות בוטלה',
  household: 'משק הבית', householdSub: 'הרשימה, הכתובת והזיכרון שייכים למשפחה — לא לאדם אחד.',
  newFamily: 'משפחה חדשה', namePh: 'שם — למשל: משפחת שמיר', country: 'מדינה',
  create: 'צור משק בית', haveFamily: 'יש לכם כבר משפחה?', askCode: 'בקשו קוד הזמנה ממי שיצר אותה.', codePh: 'קוד הזמנה', join: 'הצטרף',
  invite: 'הזמנת בן משפחה', inviteMsg: 'קוד הזמנה למשפחה: {code} (תקף 7 ימים)', inviteTitle: 'הזמנה',
  searching: 'מחפשים…', noResults: 'לא נמצא — נוסיף כמו שכתבתם', addAsTyped: 'הוסף ״{q}״ כמו שכתבתם', pickThis: 'זה', confirmed: 'נשמר בזיכרון ✓', tapToFix: 'הקישו על פריט כדי לבחור מוצר מדויק',
  orderViaKaniti: 'הזמינו דרך קניתי', orderTitle: 'ההזמנה שלכם', orderConnecting: 'מתחברים…', approveTitle: 'לאשר את ההזמנה?', approveSub: 'זה הסכום האמיתי מדף הסיכום של הרשת. שום דבר לא מחויב עד שתאשרו.',
  realTotal: 'סה״כ לתשלום', slot: 'משלוח', payment: 'תשלום', approvePay: 'אשרו ושלמו {x}', cancel: 'ביטול', placedTitle: 'ההזמנה בוצעה ✓', placedSub: 'מספר הזמנה אצל הרשת: {id}', failedTitle: 'ההזמנה לא הושלמה', failedSub: 'לא חויבתם. אפשר לנסות שוב או להזמין ישירות מהקישורים.',
  workerNote: 'קניתי ממלאת את העגלה אצל הרשת עכשיו. זה לוקח דקה-שתיים.', noWorker: 'כדי להזמין דרך קניתי צריך לחבר את חשבון הרשת פעם אחת במחשב הבית.',
  status_queued: 'בתור', status_connecting: 'מתחברים לרשת', status_filling_cart: 'ממלאים את העגלה', status_choosing_slot: 'בוחרים חלון משלוח', status_awaiting_approval: 'מחכים לאישור שלכם', status_approved: 'אושר', status_placing: 'מבצעים את ההזמנה', status_placed: 'ההזמנה בוצעה', status_cancelled: 'בוטל', status_failed: 'נכשל',
  usualShop: 'הוסיפו את הקנייה הרגילה', usualShopN: 'הוסיפו את הקנייה הרגילה · {n} פריטים', addedN: 'נוספו {n} פריטים', added: 'נוסף', otherWays: 'דרכים אחרות לקנות', bestWay: 'הדרך הכי טובה לקנות',
  orderNow: 'הזמינו דרך קניתי · {x}', linksInstead: 'או קנו לבד עם קישורים', taglineShort: 'כל הסופרים. חנות אחת.', taglineLong: 'רשימה אחת, סל אחד, כל הרשתות — ושום דבר לא נשכח.',
  whereOrder: 'איפה אתם בדרך כלל מזמינים?', whereOrderHint: 'בחרו את הרשתות. קניתי תתחבר אליהן ותלמד מה אתם קונים.', howGet: 'איך נוח לכם לקבל?', delivery_: 'משלוח', pickup_: 'איסוף עצמי', either_: 'מה שזול יותר',
  connectedStoresSub: 'חברו חנות פעם אחת — כניסה מהירה, וקניתי מזמינה בשבילכם.', connect: 'חברו', disconnect: 'נתקו', sync: 'סנכרנו', otpBadge: 'קוד ב-SMS', pwBadge: 'סיסמה · פעם אחת', createPwOnce: 'אין סיסמה? צרו פעם אחת', createPwOnceSub: 'מייל (מולא), ת.ז., קוד ב-SMS, וסיסמה שהאייפון שומר. אחר כך — Face ID.', importedNone: 'לא נמצאו הזמנות. שופרסל החזירה: {d}',
  linkTipPw: 'שימו לב: כניסת ״חברי מועדון״ נותנת רק מחירי מועדון ולא מאפשרת הזמנה. להזמנה — התחברו עם אימייל+סיסמה (Face ID ימלא) או ״התחבר עם פייסבוק״.', linkTipOtp: 'הזינו מספר טלפון וקוד ה-SMS — בלי סיסמה.',
  importingHistory: 'קוראים את ההזמנות הקודמות שלכם…', importedHistory: 'למדנו {n} הזמנות — ״הרגילים שלכם״ מוכנים.',
  connectStore: 'חיבור {s}', linkHintOtp: 'היכנסו ל{s} עם הטלפון וקוד ה-SMS — בלי סיסמה.', linkHintPw: 'היכנסו ל{s}. הסיסמה נשמרת באייפון — Face ID ימלא אותה.', imSignedIn: 'התחברתי', linkedSub: 'החשבון ב{s} מחובר. מכאן קניתי מזמינה בשבילכם.', linkNeedsApp: 'חיבור חנות נעשה באפליקציה בטלפון, שם המכשיר ממלא את הפרטים אוטומטית.', linkPrivacy: 'ההתחברות נשארת במכשיר שלכם. קניתי לא שומרת סיסמאות.', ok: 'הבנתי', addStore: 'חיבור חנות',
  connectPointer: 'חברו חנות ב״{m}״ — קניתי תלמד מה אתם קונים',
  tabHome: 'בית', tabList: 'רשימה', tabOrders: 'הזמנות', tabMe: 'אני', hello: 'שלום, {n}', aisles: 'המחלקות', browseAisle: 'לכל המוצרים ›', addToList: 'הוסף', inList: 'ברשימה ✓', from: 'החל מ', atChains: 'ב-{n} רשתות',
  ordersTitle: 'ההזמנות שלכם', noOrders: 'עדיין אין הזמנות. הרשימה הראשונה מחכה.', meTitle: 'משק הבית', members: 'בני משפחה', inviteCode: 'קוד הזמנה', signOut: 'התנתקות', yourStores: 'הרשתות שלכם', getIt: 'איך מקבלים', workerOffline: 'המחשב הבית לא מחובר עכשיו — ההזמנה תמתין בתור עד שיתחבר.',
  skip: 'דלגו', introNext: 'הבא', introStart: 'מתחילים',
  intro1Title: 'כל הסופרים. חנות אחת.', intro1Body: 'שופרסל, רמי לוי, ויקטורי, קרפור… קניתי משווה את הסל שלכם בכולן ומזמינה מהמקום שמשתלם — ואתם מאשרים פעם אחת.', intro1Tap: 'הקישו כדי לראות איך זה עובד', intro1Done: 'סל אחד. הזמנה אחת. כל הרשתות. ✓',
  intro2Title: 'קניתי לומדת מה אתם קונים', intro2Body: 'הקישו על מה שקונים אצלכם בבית. זה בדיוק מה שקניתי זוכרת — מותג, כמות, וכל כמה זמן.', intro2Memory: 'הזיכרון המשפחתי', intro2Empty: 'עדיין ריק — הקישו למעלה', intro2Usual: 'ככה נראית "הקנייה הרגילה" שלכם: {n} פריטים בהקשה אחת.',
  intro3Title: 'שום דבר לא נשכח', intro3Body: 'קניתי יודעת שחלב נגמר כל ~4 ימים. כשמגיע הזמן — היא מזכירה, לפני שקונים ביוקר במכולת.', intro3Days: 'לפני {d} ימים', intro3Due: 'הגיע הזמן לחלב — נוסיף?', intro3Rhythm: 'לומדים את הקצב…',
  introAfter: 'המסך הבא לוקח דקה: כתובת, הרשתות שלכם, ואיך נוח לכם לקבל.',
  introTryFirst: '↑ נסו את זה למעלה כדי להמשיך', intro3Added: 'נוסף לרשימה ✓',
  intro4Title: 'שלוש הקשות', intro4Body: 'ככה נראית קנייה שבועית בקניתי. נסו:', intro4a: 'הוסיפו את הקנייה הרגילה', intro4b: 'השוו בכל הרשתות', intro4c: 'אשרו את הסכום', intro4Done: 'זהו. המצרכים בדרך. 🛒',
  inclCoupon: 'כולל קופון −{x}', connectedStores: 'החנויות המחוברות', workerOnline: 'המחשב הבית מחובר', workerOff: 'המחשב הבית לא מחובר', linked: 'מחובר', notLinked: 'לא מחובר', copyCmd: 'העתיקו את הפקודה', copied: 'הועתק ✓', showIntro: 'הצג את ההקדמה שוב',
  signInTitle: 'כניסה', signUpTitle: 'יצירת חשבון', confirmTitle: 'אימות המייל', forgotTitle: 'שחזור סיסמה', resetTitle: 'סיסמה חדשה',
  email: 'אימייל', password: 'סיסמה', passwordAgain: 'הסיסמה שוב', newPassword: 'סיסמה חדשה', code: 'קוד האימות מהמייל', pwRule: 'לפחות 10 תווים, עם אות ומספר.',
  signInBtn: 'כניסה', signUpBtn: 'יצירת חשבון', confirmBtn: 'אימות', sendCode: 'שלחו לי קוד', resetBtn: 'שמירת סיסמה', noAccount: 'אין לכם חשבון? הרשמה', forgotLink: 'שכחתי סיסמה', resend: 'שלחו קוד שוב', backToSignIn: 'חזרה לכניסה', codeSent: 'שלחנו קוד ל-{e}',
  errExists: 'כבר יש חשבון עם האימייל הזה — נסו להיכנס.', errWeak: 'הסיסמה חלשה מדי: לפחות 10 תווים, עם אות ומספר.', errMismatch: 'הסיסמאות לא זהות.', errCode: 'הקוד לא נכון.', errCodeExpired: 'הקוד פג — שלחנו חדש.', errWrong: 'האימייל או הסיסמה לא נכונים.', errUnconfirmed: 'המייל עדיין לא אומת.', errLimit: 'יותר מדי ניסיונות — נסו שוב בעוד כמה דקות.',
  addressLabel: 'כתובת למשלוח', addressPh: 'רחוב ומספר, עיר — למשל: ביאליק 20 רמת גן', verified: 'מאומת', partial: 'חלקי', addressVerified: 'הכתובת אומתה', addressPartial: 'חסר מספר בית — בחרו כתובת מדויקת מהרשימה', apt: 'דירה', floor: 'קומה', entrance: 'כניסה', notesPh: 'הערות לשליח (קוד, מיקום…)', pickFromList: 'בחרו את הכתובת מהרשימה כדי להמשיך',
  boughtBefore: 'קניתם', priceAt: 'המחיר בכל רשת', cheapestHere: 'הכי זול',
  language: 'שפה',
  atNStores: 'ב-{n} רשתות', dealsTitle: 'מבצעים השבוע', dealsSub: 'ליד הבית, בכל הרשתות',
  strat_cheapest: 'הכי זול', strat_single: 'חנות אחת', strat_pickup: 'איסוף עצמי', strat_split: 'פיצול', strat_none: 'אין אפשרות כזו לסל הזה',
  mode_cheap: 'הכי זול', mode_balanced: 'מאוזן', mode_fast: 'הכי מהיר',
  tblStores: 'הסל הזה בכל חנות', tblCovers: 'מכסה {p}% מהרשימה', tblShort: 'חסרים {x} למינימום הזמנה',
  modeCheapSub: 'הכי זול: {n} משלוחים. משלוח אחד עולה עוד {x}.', modeCheapOne: 'הכי זול וגם משלוח אחד.',
  modeBalancedSub: 'חנות אחת אם היא בטווח 5% מהזול ביותר, אחרת הזול ביותר.',
  modeFastCost: 'משלוח אחד, חנות אחת: עוד {x} מהזול ביותר.', modeFastFree: 'משלוח אחד, חנות אחת — וגם הכי זול.', modeFastNone: 'אף חנות אחת לא מכסה את כל הסל.',
  whyNot: 'למה לא רשתות אחרות?', minShort: '{b}: {p} למוצרים, אבל חסרים {x} למינימום הזמנה של {m}', covShort: '{b}: מספקת רק {a} מתוך {c} פריטים', minNote: 'מינימום {m}', feeNote: 'משלוח {f}',
  nProducts: '{n} מוצרים', loadMore: 'עוד {n} מוצרים', loading: 'טוענים…', carriedBy: 'נמכר ב', pricesAtCompare: 'המחיר בכל רשת מחושב בהשוואה — על כל הסל יחד.',
  scan: 'סריקה', scanHint: 'כוונו את המצלמה לברקוד', cameraNeeded: 'צריך גישה למצלמה כדי לסרוק ברקודים', allowCamera: 'אפשר מצלמה', scanned: 'נסרק — מחפשים…',
  usuals: 'הרגילים שלכם', usualsHint: 'הקישו כדי להוסיף. הכתום — הגיע הזמן.', qty: 'כמות',
  dealsNear: 'מבצעים באזור', dealsNearSub: 'מכל הסופרים · ★ מהרגילים שלכם',
  forHome: 'לבית שלכם', forHomeSub: 'מהזיכרון של המשפחה', dueNow: 'הגיע הזמן', boughtNTimes: 'קניתם {n} פעמים',
  forgot: 'שכחתם משהו?', forgotSub: 'דברים שאתם קונים בדרך כלל ולא ברשימה. הקישו להוספה.', everyDays: 'כל ~{n} ימים · לפני {d}', boughtTimes: 'נקנה {n}×',
  emptyTitle: 'הרשימה ריקה', emptyHint: 'כתבו מה צריך — למשל ״חלב 3%״ או ״פמפרס מידה 4״. אפשר לציין מותג אם זה חשוב.',
  whatPh: 'מה צריך?', brandPh: 'מותג', add: 'הוסף {q}', compare: 'השוואת מחירים', compareN: 'השוו {n} פריטים בכל הרשתות',
  comparing: 'משווים…', comparingSub: '{n} פריטים בכל הרשתות שמגיעות ל{addr}', about20s: 'בערך 20 שניות', stillComparing: 'עדיין משווים - החנויות עונות לאט היום. שווה לחכות.', wentWrong: 'משהו השתבש', storesSlow: 'החנויות עונות לאט כרגע. נסו שוב בעוד רגע.',
  howToBuy: 'איך לקנות?', optionsSub: '{n} פריטים · {m} זוהו מהזיכרון המשפחתי', spread: ' · פער של {x} בין הרשתות',
  noneCover: 'אף רשת לא מצליחה לספק מספיק מהרשימה. נסו לשנות פריטים.', best: 'הכי משתלם', items: 'פריטים', delivery: 'משלוח', timeSeparate: 'זמן (מוצג בנפרד)',
  unavailable: 'לא זמין: {x}', deleted: '{x} הוסר', undo: 'ביטול', swipeDelete: 'מחיקה', amount: 'כמות', removeFromList: 'הסרה מהרשימה', closeSheet: 'סגירה', oosTitle: '{x} — חסר במלאי בסניף שלכם', oosInstead: 'במקומו: {y}', oosNone: 'לא מצאנו חלופה קרובה. אפשר לבחור מוצר אחר או להוריד מהרשימה.', oosPickOther: 'מוצר אחר', oosDrop: 'להוריד מהרשימה', twoDeliveries: 'שני משלוחים', savesVs: 'חוסך {x} לעומת הכל ב{b}', costsVs: 'עוד {x} לעומת הכי זול', legsLine: '{n} פריטים ב{b}', altTitle: 'עוד דרכים לקנות', buyHere: 'קנו כאן', itemsOnly: 'לפריטים שיש', swapsLine: 'חלופה: {x}', missingHere: 'אין כאן', noneAnywhere: 'אין {x} באף חנות היום', removeIt: 'הסירו מהרשימה', replaceIt: 'החליפו', driveAll: 'כל {n} הפריטים', tblMissing: 'חסר: {x}', toComplete: 'להשלמה במקום אחר ≈{x} כולל משלוח', coverage: 'כיסוי {p}%', subs: '{n} תחליפים', confirmOnce: 'כדאי לאשר פעם אחת',
  confirmOnceSub: 'המחיר של הפריטים האלה משתנה מאוד בין רשתות — כנראה זוהו כמוצרים שונים. אישור ברקוד אחד מתקן את זה לתמיד.',
  notOffered: 'לא הוצעו — לא מספקות מספיק מהרשימה', estTotal: 'סה״כ משוער', payAtStore: 'התשלום נעשה באתר הרשת. אנחנו מכינים — אתם מאשרים.',
  open: 'פתח ›', done: 'סיימתי — תזכרו את הקנייה הזו', learnsOnly: 'הזיכרון לומד רק מקנייה שהושלמה.', back: '‹ חזרה', loadingHousehold: 'טוענים את משק הבית…',
  noPricing: 'השוואת מחירים עדיין לא זמינה ב{country}. הרשימה המשותפת והזיכרון עובדים כבר עכשיו.',
  reason_cheapest: 'הסל השלם הזול ביותר מרשת אחת', reason_verified: 'רשת אחת, תנאי משלוח מאומתים', reason_split: '{n} פריטים זולים יותר ב{brand}, והחיסכון מכסה משלוח שני',
  reason_pickupCheaper: 'איסוף עצמי — זול מכל משלוח', reason_pickup: 'איסוף עצמי — יקר יותר ממשלוח כאן', reason_drive: 'זול יותר בחנות, והחיסכון מכסה את הנסיעה',
  // Connecting a store (ADR 0008)
  cloudPwTitle: 'היכנסו ל{s} — פעם אחת', cloudPwSub: 'האימייל והסיסמה של {s} נשלחים לרשת בשבילכם ומיד נמחקים. קניתי שומרת רק את החיבור — לא סיסמה, לא פרטים אישיים.',
  cloudEmailPh: 'האימייל בחשבון {s}', cloudUserPh: 'אימייל או ת.ז בחשבון {s}', cloudPwPh: 'הסיסמה ב{s}', cloudConnectBtn: 'התחברו', cloudConnecting: 'מתחברים ל{s}…',
  cloudPhoneTitle: 'חברו את {s} מהטלפון', cloudPhoneSub: '{s} מאפשרת כניסה רק מהמסך שלה (קוד ב-SMS). באפליקציה בטלפון זה לוקח רגע — והחיבור מגיע לכאן מיד.', cloudPhoneHint: 'פתחו את קניתי בטלפון › אני › חברו {s}',
  cloudWrongPw: 'האימייל או הסיסמה לא נכונים ב{s}. נסו שוב, או צרו סיסמה ב{s}.', cloudUnavailable: '{s} לא עונה כרגע. נסו שוב בעוד רגע.', cloudNoAccount: 'אין לכם חשבון ב{s}?',
  cloudConnected: '{s} מחובר', cloudConnectedSub: 'החיבור נשמר בענן של קניתי, מוצפן. מעכשיו כל טלפון של המשפחה מזמין מ{s}.',
  cloudImporting: 'קוראים את ההזמנות הקודמות שלכם ב{s}…', cloudImported: '{n} הזמנות נלמדו לזיכרון המשפחתי', cloudImportedNone: 'עדיין אין הזמנות ב{s} ללמוד מהן',
  forgotPwLink: 'שכחתם? צרו סיסמה ב{s}', signupTitle: 'חשבון חדש ב{s}', signupSub: 'הרשמה באתר של {s} לוקחת דקה. זה מה שהיא תבקש — מה שקניתי כבר יודעת מוכן להעתקה:',
  signupOpen: 'פתחו את ההרשמה ב{s}', signupThen: 'סיימתם? חזרו לכאן והתחברו.', copy: 'העתק', copiedShort: 'הועתק', notKnown: 'תמלאו בעצמכם',
  field_name: 'שם פרטי ומשפחה', field_id: 'תעודת זהות', field_phone: 'טלפון נייד', field_email: 'אימייל', field_birthdate: 'תאריך לידה', field_password: 'סיסמה חדשה', field_address: 'כתובת למשלוח', field_code: 'קוד שיגיע ב-SMS / במייל',
  storeLoadFailed: 'האתר של {s} לא נטען כרגע.', tryAgain: 'נסו שוב',
  relinkBadge: 'צריך חיבור מחדש', relinkNow: 'חברו מחדש', relinkWhyOtp: '{s} סגרו את החיבור מצדם (זה קורה אחרי זמן בלי קניות). לוחצים, מקבלים קוד ב-SMS, וזהו — 20 שניות.', relinkWhyPw: '{s} סגרו את החיבור מצדם (זה קורה אחרי זמן בלי קניות). לוחצים, Face ID ממלא את הסיסמה, וזהו.',
  pendingAsk: 'קניתם בסוף ב{s}?', pendingYes: 'כן, קניתי', pendingNo: 'לא הפעם', boughtTitle: 'מה קניתם באמת', boughtAt: 'נקנה ב{s}',
  guardChallenge: 'האתר של {s} מבקש לוודא שאתם לא רובוט — לחצו על התיבה בעמוד, ואז ממשיכים כרגיל.', guardBlocked: 'האתר של {s} חסם את הגישה מהאפליקציה כרגע. נסו שוב, או התחברו בדפדפן.', guardOpenBrowser: 'פתחו בדפדפן',
  phoneBadge: 'מהטלפון', cloudBadge: 'מהאתר', sessionSaved: 'החיבור נשמר גם בענן ✓', sessionNotSaved: 'החיבור נשמר בטלפון הזה',
  // Ordering on the phone
  orderOnPhone: 'הזמינו דרך קניתי · {x}', orderOnPhoneSub: 'הסל מתמלא באתר {s} כאן, בטלפון, בחשבון שלכם. אתם בודקים ומשלמים באתר הרשת.',
  cartFilling: 'ממלאים את הסל ב{s}', cartFillingSub: 'האתר של {s} עובד כאן, בחשבון שלכם. רגע אחד.', cartWorking: 'ממשיכים…',
  cartReady: 'הסל מוכן ב{s}', cartReadySub: 'בדקו את הסל ושלמו באתר הרשת. קניתי לא מבצעת תשלום.',
  cartSignin: 'התחברו ל{s} כדי שנמלא את הסל', cartSigninSub: 'היכנסו לחשבון {s} כאן — קניתי תמלא את הסל מיד אחרי. בלי סיסמה אצלנו.',
  cartLinks: 'פריט {i} מתוך {n} ב{s}', cartLinksSub: 'הוסיפו לסל בעמוד של הרשת, ואז ״הבא״.', cartNextItem: 'הפריט הבא', cartToCart: 'לסל של הרשת',
  perItemIn: 'נוסף לסל ✓', perItemNoCount: '{s} לא מדווחת כמה בסל — ודאו את העגלה לפני התשלום.',
  cartAdded: '{n} נוספו', storeBasket: 'בסל של {s}: {n}', storeBasketMismatch: 'הסל ב{s} מראה פחות ממה שהוספנו. בדקו אותו לפני התשלום - זה אצלנו לתיקון.', cartMissing: '{n} לא נמצאו', cartUnavailable: '{n} חסרים במלאי בסניף שלכם', outOfStockAt: '{x} (אזל בסניף שלכם)', cartError: '{n} נכשלו', cartDone: 'סיימתי — תזכרו את הקנייה', openInBrowser: 'פתחו בדפדפן', cartPlan: '{n} פריטים ל{s}',
  // Delivery time on compare
  etaLive: 'וולט · ~{m} דק׳', etaLiveRange: 'וולט · {r} דק׳', etaSlots: 'משלוח בחלון', etaSlotsSub: 'הרשת מספקת בחלונות זמן — בוחרים בעמוד ההזמנה', fastBy: 'הכי מהר: {s} · ~{m} דק׳', etaWhy: 'הזמן: וולט מגיע תוך דקות; הרשתות בחלון משלוח, לפי היום והשעה.',
  driveTitle: 'ואם נוסעים לחנות?', driveSub: 'אותה רשימה במחירי המדף בסניפים הקרובים לבית, לפי קובצי המחירים שהרשתות מפרסמות.',
  driveRow: '{d} ק״מ · ~{m} דק׳ נסיעה · ≈{x} דלק', driveCovers: '{n} מתוך {t} פריטים', driveSaves: 'חוסך {x} מול המשלוח הזול', driveCosts: 'יקר ב-{x} מהמשלוח הזול',
  drivePending: 'בודקים מחירים בסניפים הקרובים אליכם — יופיע בהשוואה הבאה.', driveNoAddress: 'כדי לראות מחירים בסניפים צריך כתובת מדויקת — בחרו אותה מההצעות במסך משק הבית.', driveSameLines: 'אותם {n} ב{s}: {x}', driveSameLine1: 'אותו פריט ב{s}: {x}', subsNamed: 'חלופה: {x}', driveNone: 'לא נמצאו סניפים עם מחירים ליד הכתובת שלכם.', driveMissing: 'לא נמצא בסניף: {x}', driveNote: 'הנסיעה מחושבת לפי מרחק; זמן הקנייה עצמה לא נספר.',
  rej_partial: 'מספקת רק {a} מתוך {b} פריטים', rej_min: 'הסל מתחת למינימום ההזמנה',
};

const en: Strings = {
  appName: 'Kaniti', tagline: 'One list for the whole family. Every store that delivers to you, compared. And a memory of what you actually buy — so nothing gets forgotten.',
  continueGoogle: 'Continue with Google', continueEmail: 'Sign in', signUp: 'Sign up — new account', orDivider: 'or', cancelled: 'Sign-in was cancelled',
  household: 'Your household', householdSub: 'The list, the address and the memory belong to the family — not to one person.',
  newFamily: 'New family', namePh: 'Name — e.g. The Shamirs', country: 'Country',
  create: 'Create household', haveFamily: 'Already have a family?', askCode: 'Ask whoever created it for an invite code.', codePh: 'Invite code', join: 'Join',
  invite: 'Invite family', inviteMsg: 'Family invite code: {code} (valid 7 days)', inviteTitle: 'Invite',
  searching: 'Searching…', noResults: 'No match — add it as typed', addAsTyped: 'Add “{q}” as typed', pickThis: 'This one', confirmed: 'Saved to memory ✓', tapToFix: 'Tap an item to pick the exact product',
  orderViaKaniti: 'Order through Kaniti', orderTitle: 'Your order', orderConnecting: 'Connecting…', approveTitle: 'Approve this order?', approveSub: 'This is the real total from the store’s review page. Nothing is charged until you approve.',
  realTotal: 'Total to pay', slot: 'Delivery', payment: 'Payment', approvePay: 'Approve and pay {x}', cancel: 'Cancel', placedTitle: 'Order placed ✓', placedSub: 'Store order number: {id}', failedTitle: 'The order did not go through', failedSub: 'You were not charged. Try again, or order directly from the links.',
  workerNote: 'Kaniti is filling your cart at the store now. This takes a minute or two.', noWorker: 'To order through Kaniti, link your store account once on the home computer.',
  status_queued: 'Queued', status_connecting: 'Connecting to the store', status_filling_cart: 'Filling the cart', status_choosing_slot: 'Choosing a delivery slot', status_awaiting_approval: 'Waiting for your approval', status_approved: 'Approved', status_placing: 'Placing the order', status_placed: 'Order placed', status_cancelled: 'Cancelled', status_failed: 'Failed',
  usualShop: 'Add the usual shop', usualShopN: 'Add the usual shop · {n} items', addedN: '{n} items added', added: 'Added', otherWays: 'Other ways to buy', bestWay: 'Best way to buy',
  orderNow: 'Order through Kaniti · {x}', linksInstead: 'or buy yourself with links', taglineShort: 'Every store. One shop.', taglineLong: 'One list, one basket, every chain — and nothing forgotten.',
  whereOrder: 'Where do you usually order?', whereOrderHint: 'Pick your chains. Kaniti connects to them and learns what you buy.', howGet: 'How do you like to get it?', delivery_: 'Delivery', pickup_: 'Pickup', either_: 'Whichever is cheaper',
  connectedStoresSub: 'Connect a store once — a quick sign-in, and Kaniti orders for you.', connect: 'Connect', disconnect: 'Disconnect', sync: 'Sync', otpBadge: 'SMS code', pwBadge: 'Password · once', createPwOnce: 'No password? Create one, once', createPwOnceSub: 'E-mail (filled), ID number, SMS code, and a password your iPhone saves. Then it is Face ID.', importedNone: 'No orders found. Shufersal returned: {d}',
  linkTipPw: 'Note: the “club member” sign-in only gives club prices, not ordering. To order, sign in with email+password (Face ID fills it) or “Log in with Facebook”.', linkTipOtp: 'Enter your phone number and the SMS code — no password.',
  importingHistory: 'Reading your past orders…', importedHistory: 'Learned {n} orders — your usuals are ready.',
  connectStore: 'Connect {s}', linkHintOtp: 'Sign in to {s} with your phone and the SMS code — no password.', linkHintPw: 'Sign in to {s}. Your password is on the iPhone — Face ID fills it.', imSignedIn: "I'm signed in", linkedSub: 'Your {s} account is connected. Kaniti orders for you from here.', linkNeedsApp: 'Connecting a store happens in the phone app, where the device fills your details automatically.', linkPrivacy: 'The sign-in stays on your device. Kaniti stores no passwords.', ok: 'Got it', addStore: 'Connect a store',
  connectPointer: 'Connect a store under “{m}” — Kaniti learns what you buy',
  tabHome: 'Home', tabList: 'List', tabOrders: 'Orders', tabMe: 'Me', hello: 'Hi, {n}', aisles: 'Aisles', browseAisle: 'All products ›', addToList: 'Add', inList: 'In list ✓', from: 'from', atChains: 'at {n} chains',
  ordersTitle: 'Your orders', noOrders: 'No orders yet. Your first list is waiting.', meTitle: 'Household', members: 'Family', inviteCode: 'Invite code', signOut: 'Sign out', yourStores: 'Your stores', getIt: 'How you get it', workerOffline: 'The home computer is offline — the order will wait in the queue until it connects.',
  skip: 'Skip', introNext: 'Next', introStart: 'Let’s go',
  intro1Title: 'Every store. One shop.', intro1Body: 'Shufersal, Rami Levy, Victory, Carrefour… Kaniti prices your basket at all of them and orders from wherever wins — you approve once.', intro1Tap: 'Tap to see how it works', intro1Done: 'One basket. One order. Every chain. ✓',
  intro2Title: 'Kaniti learns what you buy', intro2Body: 'Tap what your home actually buys. That is exactly what Kaniti remembers — brand, amount, and how often.', intro2Memory: 'Family memory', intro2Empty: 'Empty so far — tap above', intro2Usual: 'This is your “usual shop”: {n} items in one tap.',
  intro3Title: 'Nothing forgotten', intro3Body: 'Kaniti knows milk runs out every ~4 days. When it is time, it reminds you — before you pay corner-shop prices.', intro3Days: '{d} days ago', intro3Due: 'Milk is due — add it?', intro3Rhythm: 'Learning the rhythm…',
  introAfter: 'The next screen takes a minute: your address, your stores, and how you like to get it.',
  introTryFirst: '↑ Try it above to continue', intro3Added: 'Added to the list ✓',
  intro4Title: 'Three taps', intro4Body: 'This is a weekly shop in Kaniti. Try it:', intro4a: 'Add the usual shop', intro4b: 'Compare every store', intro4c: 'Approve the total', intro4Done: 'That’s it. Groceries on the way. 🛒',
  inclCoupon: 'incl. coupon −{x}', connectedStores: 'Connected stores', workerOnline: 'Home computer online', workerOff: 'Home computer offline', linked: 'Linked', notLinked: 'Not linked', copyCmd: 'Copy the command', copied: 'Copied ✓', showIntro: 'Show the intro again',
  signInTitle: 'Sign in', signUpTitle: 'Create account', confirmTitle: 'Verify your email', forgotTitle: 'Reset password', resetTitle: 'New password',
  email: 'Email', password: 'Password', passwordAgain: 'Password again', newPassword: 'New password', code: 'Verification code from email', pwRule: 'At least 10 characters, with a letter and a number.',
  signInBtn: 'Sign in', signUpBtn: 'Create account', confirmBtn: 'Verify', sendCode: 'Send me a code', resetBtn: 'Save password', noAccount: 'No account? Sign up', forgotLink: 'Forgot password', resend: 'Resend code', backToSignIn: 'Back to sign in', codeSent: 'We sent a code to {e}',
  errExists: 'There is already an account with this email — try signing in.', errWeak: 'Password too weak: at least 10 characters, with a letter and a number.', errMismatch: 'Passwords do not match.', errCode: 'Wrong code.', errCodeExpired: 'Code expired — we sent a new one.', errWrong: 'Wrong email or password.', errUnconfirmed: 'Email not verified yet.', errLimit: 'Too many attempts — try again in a few minutes.',
  addressLabel: 'Delivery address', addressPh: 'Street and number, city', verified: 'Verified', partial: 'Partial', addressVerified: 'Address verified', addressPartial: 'Missing house number — pick an exact address from the list', apt: 'Apt', floor: 'Floor', entrance: 'Entrance', notesPh: 'Notes for the courier (code, location…)', pickFromList: 'Pick the address from the list to continue',
  boughtBefore: 'Bought before', priceAt: 'Price at every store', cheapestHere: 'Cheapest',
  language: 'Language',
  atNStores: 'at {n} stores', dealsTitle: 'Deals this week', dealsSub: 'Near you, across every chain',
  strat_cheapest: 'Cheapest', strat_single: 'One store', strat_pickup: 'Pickup', strat_split: 'Split', strat_none: 'No such option for this basket',
  mode_cheap: 'Cheapest', mode_balanced: 'Balanced', mode_fast: 'Fastest',
  tblStores: 'This basket at every store', tblCovers: 'Covers {p}% of the list', tblShort: '{x} short of the minimum order',
  modeCheapSub: 'Cheapest: {n} deliveries. One delivery costs {x} more.', modeCheapOne: 'Cheapest, and one delivery.',
  modeBalancedSub: 'One store if it is within 5% of the cheapest, otherwise the cheapest.',
  modeFastCost: 'One delivery, one store: {x} more than the cheapest.', modeFastFree: 'One delivery, one store — and the cheapest.', modeFastNone: 'No single store covers the whole basket.',
  whyNot: 'Why not other stores?', minShort: '{b}: {p} for the items, but {x} short of the {m} minimum', covShort: '{b}: supplies only {a} of {c} items', minNote: 'min {m}', feeNote: 'delivery {f}',
  nProducts: '{n} products', loadMore: '{n} more products', loading: 'Loading…', carriedBy: 'Carried by', pricesAtCompare: 'Per-chain prices are computed at compare time — for the whole basket at once.',
  scan: 'Scan', scanHint: 'Point the camera at a barcode', cameraNeeded: 'Camera access is needed to scan barcodes', allowCamera: 'Allow camera', scanned: 'Scanned — looking it up…',
  usuals: 'Your usuals', usualsHint: 'Tap to add. Amber means it is about due.', qty: 'Qty',
  dealsNear: 'Deals nearby', dealsNearSub: 'Every store · ★ your usuals',
  forHome: 'For your home', forHomeSub: "From the family's memory", dueNow: 'About due', boughtNTimes: 'Bought {n} times',
  forgot: 'Forgot something?', forgotSub: 'Things you usually buy that are not on the list. Tap to add.', everyDays: 'every ~{n} days · {d} days ago', boughtTimes: 'bought {n}×',
  emptyTitle: 'Your list is empty', emptyHint: 'Type what you need — “milk 3%”, “Pampers size 4”. Add a brand if it matters.',
  whatPh: 'What do you need?', brandPh: 'Brand', add: 'Add {q}', compare: 'Compare prices', compareN: 'Compare {n} items across every store',
  comparing: 'Comparing…', comparingSub: '{n} items across every store delivering to {addr}', about20s: 'About 20 seconds', stillComparing: 'Still comparing - the stores are slow today. Worth the wait.', wentWrong: 'Something went wrong', storesSlow: 'The stores are answering slowly right now. Try again in a moment.',
  howToBuy: 'How to buy?', optionsSub: '{n} items · {m} resolved from family memory', spread: ' · {x} spread between stores',
  noneCover: 'No store can supply enough of this list. Try changing items.', best: 'Best value', items: 'items', delivery: 'delivery', timeSeparate: 'Time (shown separately)',
  unavailable: 'Unavailable: {x}', deleted: '{x} removed', undo: 'Undo', swipeDelete: 'Delete', amount: 'Amount', removeFromList: 'Remove from the list', closeSheet: 'Close', oosTitle: '{x} — out of stock at your branch', oosInstead: 'Instead: {y}', oosNone: 'No close alternative. Pick another product, or drop the line.', oosPickOther: 'Another product', oosDrop: 'Drop from the list', twoDeliveries: 'Two deliveries', savesVs: 'Saves {x} vs everything at {b}', costsVs: '{x} more than the cheapest', legsLine: '{n} items at {b}', altTitle: 'Other ways to buy', buyHere: 'Buy here', itemsOnly: 'for the items it has', swapsLine: 'Substitute: {x}', missingHere: 'not here', noneAnywhere: 'No store has {x} today', removeIt: 'Remove from list', replaceIt: 'Replace', driveAll: 'All {n} items', tblMissing: 'Missing: {x}', toComplete: 'to complete elsewhere ≈{x} incl. delivery', coverage: '{p}% coverage', subs: '{n} substitutions', confirmOnce: 'Worth confirming once',
  confirmOnceSub: 'These items vary a lot in price between stores — probably matched to different products. Confirming a barcode once fixes it for good.',
  notOffered: 'Not offered — cannot supply enough of the list', estTotal: 'Estimated total', payAtStore: 'Payment happens on the store’s site. We prepare — you approve.',
  open: 'Open ›', done: 'Done — remember this shop', learnsOnly: 'Memory learns only from completed shops.', back: '‹ Back', loadingHousehold: 'Loading your household…',
  noPricing: 'Price comparison is not available in {country} yet. The shared list and memory work today.',
  reason_cheapest: 'Cheapest complete basket from one store', reason_verified: 'One store, verified delivery terms', reason_split: '{n} items are cheaper at {brand}, and the saving clears a second delivery fee',
  reason_pickupCheaper: 'Collect yourself — cheaper than any delivery', reason_pickup: 'Collect yourself — costs more than delivery here', reason_drive: 'Cheaper in store, and the saving clears the drive',
  // Connecting a store (ADR 0008)
  cloudPwTitle: 'Sign in to {s} — once', cloudPwSub: 'Your {s} email and password are forwarded to the store for you and discarded at once. Kaniti keeps only the connection — no password, no personal details.',
  cloudEmailPh: 'Email on your {s} account', cloudUserPh: 'Email or ID on your {s} account', cloudPwPh: 'Your {s} password', cloudConnectBtn: 'Sign in', cloudConnecting: 'Signing in to {s}…',
  cloudPhoneTitle: 'Connect {s} from your phone', cloudPhoneSub: '{s} only lets you in from its own screen (SMS code). In the Kaniti app on your phone it takes a moment — and the connection shows up here right away.', cloudPhoneHint: 'Open Kaniti on your phone › Me › Connect {s}',
  cloudWrongPw: 'That email or password is not right at {s}. Try again, or create a password at {s}.', cloudUnavailable: '{s} is not answering right now. Try again in a moment.', cloudNoAccount: 'No {s} account?',
  cloudConnected: '{s} connected', cloudConnectedSub: 'The connection is kept in Kaniti’s cloud, encrypted. From now on every phone in the family orders from {s}.',
  cloudImporting: 'Reading your past {s} orders…', cloudImported: '{n} orders learned into the family memory', cloudImportedNone: 'No {s} orders to learn from yet',
  forgotPwLink: 'Forgot? Create a password at {s}', signupTitle: 'New {s} account', signupSub: 'Signing up on {s}’s site takes a minute. This is what it asks for — what Kaniti already knows is ready to copy:',
  signupOpen: 'Open {s} sign-up', signupThen: 'Done? Come back here and sign in.', copy: 'Copy', copiedShort: 'Copied', notKnown: 'You fill this in',
  field_name: 'First and last name', field_id: 'ID number', field_phone: 'Mobile phone', field_email: 'Email', field_birthdate: 'Date of birth', field_password: 'New password', field_address: 'Delivery address', field_code: 'Code sent by SMS / email',
  storeLoadFailed: '{s}’s site did not load just now.', tryAgain: 'Try again',
  relinkBadge: 'Needs re-connecting', relinkNow: 'Re-connect', relinkWhyOtp: '{s} closed the session on their side (it happens after a while without shopping). Tap, get an SMS code, done — 20 seconds.', relinkWhyPw: '{s} closed the session on their side (it happens after a while without shopping). Tap, Face ID fills the password, done.',
  pendingAsk: 'Did you buy at {s} in the end?', pendingYes: 'Yes, I did', pendingNo: 'Not this time', boughtTitle: 'What you really bought', boughtAt: 'Bought at {s}',
  guardChallenge: '{s}’s site wants to check you are human — tap the box on the page, then carry on as usual.', guardBlocked: '{s}’s site is blocking the app right now. Try again, or sign in in the browser.', guardOpenBrowser: 'Open in browser',
  phoneBadge: 'On the phone', cloudBadge: 'From the site', sessionSaved: 'Connection also saved to the cloud ✓', sessionNotSaved: 'Connection saved on this phone',
  // Ordering on the phone
  orderOnPhone: 'Order through Kaniti · {x}', orderOnPhoneSub: 'The cart fills on {s}’s site right here on your phone, in your account. You check and pay on the store’s site.',
  cartFilling: 'Filling your {s} cart', cartFillingSub: '{s}’s site is working here, in your account. One moment.', cartWorking: 'Working…',
  cartReady: 'Your {s} cart is ready', cartReadySub: 'Check the cart and pay on the store’s site. Kaniti never completes a payment.',
  cartSignin: 'Sign in to {s} so we can fill your cart', cartSigninSub: 'Sign in to your {s} account here — Kaniti fills the cart right after. No password kept by us.',
  cartLinks: 'Item {i} of {n} at {s}', cartLinksSub: 'Add it to the cart on the store’s page, then “Next”.', cartNextItem: 'Next item', cartToCart: 'To the store’s cart',
  perItemIn: 'In the basket ✓', perItemNoCount: '{s} does not report its basket — check the cart before you pay.',
  cartAdded: '{n} added', storeBasket: '{s} basket: {n}', storeBasketMismatch: 'The {s} basket shows fewer than we added. Check it before paying - this one is on us to fix.', cartMissing: '{n} not found', cartUnavailable: '{n} out of stock at your branch', outOfStockAt: '{x} (out of stock at your branch)', cartError: '{n} failed', cartDone: 'Done — remember this shop', openInBrowser: 'Open in browser', cartPlan: '{n} items for {s}',
  // Delivery time on compare
  etaLive: 'Wolt · ~{m} min', etaLiveRange: 'Wolt · {r} min', etaSlots: 'Window delivery', etaSlotsSub: 'The chain delivers in time windows — you pick one at checkout', fastBy: 'Fastest: {s} · ~{m} min', etaWhy: 'Time: Wolt arrives within minutes; the chains deliver in windows that shift by day and hour.',
  driveTitle: 'And if you drive there?', driveSub: 'The same list at shelf prices in the branches near home, from the price files the chains publish.',
  driveRow: '{d} km · ~{m} min drive · ≈{x} fuel', driveCovers: '{n} of {t} items', driveSaves: 'Saves {x} vs the cheapest delivery', driveCosts: '{x} more than the cheapest delivery',
  drivePending: 'Checking prices at the branches near you — shows on the next compare.', driveNoAddress: 'In-store prices need an exact address — pick it from the suggestions on the Household screen.', driveSameLines: 'Same {n} at {s}: {x}', driveSameLine1: 'Same item at {s}: {x}', subsNamed: 'Substitute: {x}', driveNone: 'No branches with published prices near your address.', driveMissing: 'Not at this branch: {x}', driveNote: 'Driving is priced by distance; the shopping itself is not counted.',
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
