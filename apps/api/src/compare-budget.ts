/**
 * How long a compare may take, kept apart from the route so the rules can be tested as they ship
 * (importing apps/api/src/index.ts from a test does not parse; see docs/backlog/api-fixer.md).
 *
 * The sync route (the ops checks, and the phone when the job cannot start) has one clock inside API
 * Gateway's 30 s. Each step gets its own share of it: the barcode pass must answer, the words pass
 * may run until its share ends, the substitutes get theirs, and the steps after them (barcodes,
 * pictures, delivery windows, in-store) run side by side on what is left. The background job keeps
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

/** The steps after the substitutes: barcodes, pictures, delivery windows, in-store, side by side. */
const TAIL_MS = 2_000;

/**
 * How long the words pass (pinned lines asked for again by their words, beside the barcode pass) may
 * run. It is a rung, not the answer: past its time the barcode pass stands and the substitutes fill
 * the gaps. It ends five seconds before the try's own deadline, because a try past that deadline
 * loses the priced barcode answer too: on 2026-10-10 the chaotic list's barcode pass answered in
 * 10 s, its words pass was still running at 22 s, and the compare was a 503 'stores_slow'. Not
 * shorter: the week for five's words pass took 18.6 s that morning, and a words pass that makes it
 * fills gaps the substitutes' twelve sync searches cannot. Sync: 21 s. A 39-line job: 40 s.
 */
export const wordsPassMs = (budget: CompareBudget): number => Math.max(0, budget.tryMs - 5_000);

/**
 * What is left for the tail, on the same clock: the sync route ends by 28 s, inside API Gateway's
 * 30 s, however late the steps before ran (it used to run up to 13 s more after the substitutes'
 * deadline). At least a second, so a late compare still gets what is cached. The job gives each
 * step its own cap and does not need this one.
 */
export const tailMs = (budget: CompareBudget, elapsedMs: number): number =>
  budget.totalMs > 60_000 ? 45_000 : Math.max(1_000, budget.totalMs + TAIL_MS - elapsedMs);
