/**
 * Aisle grouping for the list — deterministic keyword matching, no model.
 * Order is a plausible walk through a store; the family sees dairy first
 * because it is what they forget most.
 */
export type Aisle = 'dairy' | 'produce' | 'bakery' | 'meat' | 'pantry' | 'frozen' | 'drinks' | 'baby' | 'household' | 'other';

export const AISLES: { key: Aisle; glyph: string; he: string; en: string }[] = [
  { key: 'dairy', glyph: '🥛', he: 'חלב וביצים', en: 'Dairy & eggs' },
  { key: 'produce', glyph: '🥬', he: 'ירקות ופירות', en: 'Produce' },
  { key: 'bakery', glyph: '🍞', he: 'לחם ומאפים', en: 'Bakery' },
  { key: 'meat', glyph: '🍗', he: 'בשר ודגים', en: 'Meat & fish' },
  { key: 'pantry', glyph: '🫙', he: 'מזווה', en: 'Pantry' },
  { key: 'frozen', glyph: '🧊', he: 'קפואים', en: 'Frozen' },
  { key: 'drinks', glyph: '🧃', he: 'משקאות', en: 'Drinks' },
  { key: 'baby', glyph: '🍼', he: 'תינוקות', en: 'Baby' },
  { key: 'household', glyph: '🧴', he: 'ניקיון ובית', en: 'Household' },
  { key: 'other', glyph: '🛒', he: 'עוד', en: 'Other' },
];

const RULES: [Aisle, RegExp][] = [
  ['baby', /פמפרס|האגיס|חיתול|מגבונים|מטרנה|סימילאק|pampers|huggies|diaper|nappy|wipes|formula/i],
  ['dairy', /חלב|קוטג|גבינ|יוגורט|חמאה|שמנת|ביצים|לבן|מעדן|milk|cheese|yogurt|yoghurt|butter|cream|eggs?\b/i],
  ['produce', /עגבני|מלפפון|בצל|תפוח|גזר|פלפל|בננ|אבוקדו|חסה|תות|לימון|ירק|פרי|tomato|cucumber|onion|apple|carrot|pepper|banana|avocado|lettuce|berry|lemon|potato|orange/i],
  ['bakery', /לחם|פית|חלה|לחמני|בייגל|מאפ|bread|pita|challah|bun|bagel|roll/i],
  ['meat', /עוף|בשר|טחון|סלמון|דג|טונה|הודו|שניצל|נקניק|chicken|beef|mince|salmon|fish|tuna|turkey|sausage|steak/i],
  ['frozen', /קפוא|גלידה|frozen|ice cream/i],
  ['drinks', /מים|קולה|מיץ|בירה|יין|קפה|תה|סודה|water|cola|juice|beer|wine|coffee|tea|soda/i],
  ['household', /נייר|טואלט|מדיח|כביסה|סבון|שקיות|אקונומיקה|ניקוי|מגבת|toilet|dishwasher|laundry|detergent|soap|bags|bleach|cleaner|towel|tissue/i],
  ['pantry', /אורז|פסטה|רסק|שמן|סוכר|קמח|מלח|טופו|חומוס|טחינה|שימור|דגני|קורנפלקס|שוקולד|חטיף|rice|pasta|sauce|oil|sugar|flour|salt|tofu|hummus|tahini|cereal|chocolate|snack|can/i],
];

export function aisleOf(query: string): Aisle {
  for (const [a, re] of RULES) if (re.test(query)) return a;
  return 'other';
}
