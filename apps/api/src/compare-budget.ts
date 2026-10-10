/**
 * How long a compare may take, kept apart from the route so the rules can be tested as they ship
 * (importing apps/api/src/index.ts from a test does not parse; see docs/backlog/api-fixer.md).
 *
 * The sync route (the ops checks, and the phone when the job cannot start) has one clock inside API
 * Gateway's 30 s: the quote has its try, the substitutes their share, and the steps after them
 * (barcodes, pictures, delivery windows, in-store) run side by side. The background job keeps
 * minutes for every step.
 */

/** One try inside API Gateway's 30 s (the sync route), or several tries in the background job. */
export type CompareBudget = { tryMs: number; totalMs: number };

export const SYNC_BUDGET: CompareBudget = { tryMs: 26_000, totalMs: 26_000 };

/**
 * The background job's budget grows with the basket, because the work does: the provider takes at
 * most fifty items in a call, so a sixty-line list is two calls a pass and two passes, plus the
 * substitutes. A flat 110 s failed a real family's list at 113 s and gave them nothing (reproduced
 * on production, 13 September). The phone waits on a row, not on a clock, so a longer wait is only
 * a longer wait - and the copy on screen says so past 35 seconds.
 */
export function jobBudget(lines: number): CompareBudget {
  const chunks = Math.max(1, Math.ceil(lines / 50));
  return { tryMs: Math.min(120_000, 45_000 * chunks), totalMs: Math.min(280_000, 90_000 + 45_000 * chunks) };
}

/** The substitutes' share: seconds on the sync route, minutes in the job. */
export const substituteShareMs = (budget: CompareBudget): number => (budget.totalMs > 60_000 ? 45_000 : 9_000);

/** How long the substitutes may run, `elapsedMs` after the quote started: their share, and on the sync route never past 27 s. */
export const substitutesMs = (budget: CompareBudget, elapsedMs: number): number =>
  Math.max(0, Math.min(substituteShareMs(budget), budget.totalMs + 1_000 - elapsedMs));

/** The steps after the substitutes (barcodes, pictures, delivery windows, in-store) run side by side; the capped ones end 2 s after the substitutes' last moment. */
const TAIL_MS = 2_000;

/**
 * What is left for the tail's pictures and delivery windows, on the same clock: they stop by 28 s on
 * the sync route, inside API Gateway's 30 s, however late the steps before ran. At least a second,
 * so a late compare still gets what is cached. The job gives each step its own cap.
 */
export const tailMs = (budget: CompareBudget, elapsedMs: number): number =>
  budget.totalMs > 60_000 ? 45_000 : Math.max(1_000, budget.totalMs + TAIL_MS - elapsedMs);
