/**
 * Money is integer agorot. Never a float.
 *
 * Israeli grocery prices carry two decimals and baskets run to ~40 lines; float
 * addition drifts and the drift lands in a number the family compares against a
 * receipt. Every price in this system is an integer, and conversion happens only
 * at the edges.
 */

/** An amount in agorot (1/100 ILS). Always an integer. */
export type Agorot = number & { readonly __brand: 'Agorot' };

export const agorot = (n: number): Agorot => {
  if (!Number.isInteger(n)) throw new RangeError(`Agorot must be an integer, got ${n}`);
  return n as Agorot;
};

/**
 * Convert a shekel figure (e.g. 35.90) to agorot, rounding half away from zero.
 *
 * Naively `Math.round(n * 100)` is wrong: 1.005 * 100 is 100.49999999999999 in
 * IEEE754, which rounds *down* and loses an agora. Prices arrive from provider
 * JSON as floats, so this path has to be correct. `toPrecision(15)` absorbs the
 * representation error while staying well inside a double's 15-17 significant
 * digits — a basket total never approaches that magnitude.
 */
export const shekels = (n: number): Agorot => {
  if (!Number.isFinite(n)) throw new RangeError(`Not a finite number: ${n}`);
  const scaled = Number((Math.abs(n) * 100).toPrecision(15));
  return agorot(Math.sign(n) * Math.round(scaled));
};

export const addAgorot = (...xs: readonly Agorot[]): Agorot =>
  agorot(xs.reduce<number>((a, b) => a + b, 0));

export const subAgorot = (a: Agorot, b: Agorot): Agorot => agorot(a - b);

/** Multiply by a non-integer quantity (e.g. 2.5 kg), rounding half away from zero. */
export const scaleAgorot = (a: Agorot, factor: number): Agorot => {
  if (!Number.isFinite(factor)) throw new RangeError(`Not a finite factor: ${factor}`);
  const v = a * factor;
  return agorot(Math.sign(v) * Math.round(Math.abs(v)));
};

/** Format for display: 83620 -> "₪836.20". */
export const formatILS = (a: Agorot): string => {
  const sign = a < 0 ? '-' : '';
  const abs = Math.abs(a);
  return `${sign}₪${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
};
