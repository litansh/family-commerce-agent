/**
 * The second try at a line that found nothing: the same words, written the way the catalogue
 * spells them. Two slips families make all the time and a catalogue's fuzzy search does not undo:
 *
 *  - a final letter typed as its middle form ("מלפפונימ" for "מלפפונים", "לחמ" for "לחם") — the
 *    keyboard has both and voice-to-text and fast thumbs pick the wrong one; the catalogue then
 *    offers only unpriced near-misses ("מלפפון");
 *  - an English word beside the Hebrew ("חלב milk 3%") — the catalogue reads "milk" as part of the
 *    name and ranks "חלבה" above milk.
 *
 * Deterministic and conservative: returns undefined when there is nothing to repair, so the caller
 * never searches the same words twice. A line with no Hebrew word keeps its English (an all-English
 * line is a real query, "olive oil").
 */
const FINAL: Record<string, string> = { כ: 'ך', מ: 'ם', נ: 'ן', פ: 'ף', צ: 'ץ' };
const HEBREW = /[֐-׿]/;
const LATIN_WORD = /^[A-Za-z]+$/;

export function repairQuery(query: string): string | undefined {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return undefined;
  const hasHebrew = words.some((w) => HEBREW.test(w));
  const kept = hasHebrew ? words.filter((w) => !LATIN_WORD.test(w)) : words;
  const fixed = kept.map((w) => {
    // Only a Hebrew word of two letters or more; the last letter decides.
    if (w.length < 2 || !HEBREW.test(w)) return w;
    const last = w[w.length - 1]!;
    return FINAL[last] !== undefined ? w.slice(0, -1) + FINAL[last] : w;
  });
  const out = fixed.join(' ');
  return out && out !== words.join(' ') ? out : undefined;
}

/**
 * Does a free-text line say anything a store could price? At least one word with a letter in it, two
 * letters or more, not one letter typed over and over, and not longer than any real word. Emoji, a
 * bare number and two hundred copies of one letter (ops/chaos.mjs) all fail; Hebrew with niqqud,
 * "7up", "AA" and "ביצים L" all pass. /resolve already refuses to choose a product for a line that
 * fails, and the provider prices it at no store (measured 2026-10-10), but asking still cost the
 * chaotic list's compare 6-7 s of the provider's time.
 */
export function hasWordToQuote(query: string): boolean {
  return query
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .some((w) => /\p{L}/u.test(w) && w.length >= 2 && w.length <= 40 && !/^(\p{L})\1{3,}$/u.test(w));
}
