import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PICK_BY_NAME_JS } from '../src/lib/stores.ts';

// The very source that ships inside the store's page.
const pick = new Function(`${PICK_BY_NAME_JS}; return __kPick;`)() as (rows: { id: number; name: string }[], q: string) => { id: number; name: string } | null;

// Rami Levy's own answer to "מיץ פירות הדרים" (captured from its catalogue).
const citrusAnswer = [
  { id: 304738, name: 'מיץ לימון 250 מ"ל' },
  { id: 99399, name: 'מיץ לימון טעמן 500 מ"ל' },
  { id: 377795, name: 'מיץ דובדבן 100% גרוזיני 1 ליטר' },
  { id: 1, name: 'מיץ עגבניות פרימור 1 ליטר' },
];

test('a shared head word is not a match: no lemon, cherry or tomato juice for citrus juice', () => {
  assert.equal(pick(citrusAnswer, 'מיץ פירות הדרים'), null);
});

test('the real thing is picked when the store has it', () => {
  const rows = [...citrusAnswer, { id: 42, name: 'מיץ פירות הדר 100% פריגת 1 ליטר' }];
  assert.equal(pick(rows, 'מיץ פירות הדרים')?.id, 42);
});

test('orange juice picks the juice, not the orange-flavoured drink', () => {
  const rows = [
    { id: 386534, name: 'משקה קל בטעם תפוזים פריגת 1.5 ליטר' },
    { id: 2516, name: 'מיץ תפוזים סחוט רכיבים טבעיים פריגת 1 ליטר' },
  ];
  assert.equal(pick(rows, 'מיץ תפוזים')?.id, 2516);
});

test('final letters and plurals do not hide a match (חלב תנובה)', () => {
  assert.equal(pick([{ id: 7, name: 'חלב תנובה 3% שומן 1 ל\' קרטון' }], 'חלב תנובה')?.id, 7);
});

test('an empty answer, or a query of only short words, picks nothing', () => {
  assert.equal(pick([], 'מיץ תפוזים'), null);
  assert.equal(pick([{ id: 1, name: 'מלח ים' }], 'ים'), null);
});

test('a short stem never matches by prefix: "לא קיים" is not "קייק"', () => {
  // The daily cart lab caught this: its deliberately absent line was added as a cake tin, because
  // "קיים" stemmed to "קי" and prefix-matched "קייק".
  assert.equal(pick([{ id: 5, name: 'קופסת אחסון אניגליש קייק' }], 'לא קיים'), null);
  assert.equal(pick([{ id: 6, name: 'עוגת קייק שיש' }], 'קייק שיש')?.id, 6);
});
