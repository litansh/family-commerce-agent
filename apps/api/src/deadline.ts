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

/** True for the deadline, the MCP client's abort ("This operation was aborted"), and a dropped connection. */
export function isSlowError(e: unknown): boolean {
  if (e instanceof DeadlinePassed) return true;
  if (!(e instanceof Error)) return false;
  return e.name === 'AbortError' || /aborted|timeout|timed out|fetch failed|ECONNRESET|socket hang up/i.test(e.message);
}
