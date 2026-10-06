/**
 * A deadline over a promise, and the one question the compare asks of an error: was the provider
 * slow (retry, or tell the family the stores are slow) or was it something else (surface it)?
 */
export class DeadlinePassed extends Error {
  constructor(ms: number) { super(`deadline of ${ms} ms passed`); this.name = 'DeadlinePassed'; }
}

/** Rejects with DeadlinePassed when `p` has not settled within `ms`. The work itself is not cancelled. */
export function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clock = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new DeadlinePassed(ms)), ms); });
  return Promise.race([p, clock]).finally(() => clearTimeout(timer));
}

/**
 * True for the deadline, the MCP client's abort ("This operation was aborted"), a dropped connection,
 * and the vendor's own "Service is busy" (service_busy): busy is the stores being slow in another
 * word, worth another pass, and never a 500 'internal error' (production, 2026-10-03).
 */
export function isSlowError(e: unknown): boolean {
  if (e instanceof DeadlinePassed) return true;
  if (!(e instanceof Error)) return false;
  return e.name === 'AbortError' || /aborted|timeout|timed out|fetch failed|ECONNRESET|socket hang up|service_busy|service is busy|HTTP 429/i.test(e.message);
}
