/**
 * Minimal streamable-HTTP MCP client.
 *
 * SuperMCP replies as `text/event-stream` even for a single JSON-RPC response,
 * so we read the body and take the first `data:` frame. A full MCP SDK would be
 * a dependency and a lot of machinery for two call shapes.
 */

export interface McpError {
  readonly code: number;
  readonly message: string;
}

export class McpCallError extends Error {
  readonly detail: unknown;
  constructor(message: string, detail?: unknown) {
    super(message);
    this.name = 'McpCallError';
    this.detail = detail;
  }
}

/** SuperMCP's own transient failure: never a validation problem, worth one more try. */
const TRANSIENT = /internal_error|internal server error|service_busy|service is busy|HTTP 429|HTTP 503/i;
/**
 * The vendor's "Service is busy. Please retry shortly." (code service_busy): it refuses calls when too
 * many arrive at once (measured from the ops Mac 2026-10-03: 4 or 8 parallel searches all answer,
 * 16 get three refusals; production logged 60 in two minutes of a health run, each one a 500 or an
 * unresolved line because only internal_error was retried).
 */
export const isBusyError = (e: unknown): boolean => e instanceof Error && /service_busy|service is busy|HTTP 429/i.test(e.message);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One gate per Lambda instance across every client: a resolve runs four lines at once with two
 * searches each, a compare's substitutes four more, and the vendor starts refusing past about a dozen.
 */
const MAX_IN_FLIGHT = 6;
let inFlight = 0;
const waiting: (() => void)[] = [];
async function gate<T>(work: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((r) => waiting.push(r));
  inFlight++;
  try { return await work(); } finally { inFlight--; waiting.shift()?.(); }
}

export class McpClient {
  #id = 0;
  readonly #url: string;
  readonly #timeoutMs: number;
  readonly #retries: number;

  /**
   * `retries` bounds a retry-with-backoff on the vendor's own `internal_error` (free, unversioned,
   * no SLA — this happens) — never on a validation error, and never past `retries` attempts, so one
   * bad call costs a fixed amount of time, not an unbounded wait.
   */
  constructor(url: string, timeoutMs = 120_000, retries = 0) {
    this.#url = url;
    this.#timeoutMs = timeoutMs;
    this.#retries = retries;
  }

  /**
   * The provider errs in short bursts: the same call that answered `internal_error` answers in
   * 200 ms a second later (measured 2026-09-12: 'טופו' failed after 20.7 s, then five products in
   * 468 ms). A transient error is therefore retried twice with a short backoff before it is anyone
   * else's problem. A refusal that is not transient (a bad argument) is passed straight up.
   */
  async callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await gate(() => this.#callOnce<T>(name, args));
      } catch (e) {
        if (attempt >= this.#retries || !(e instanceof McpCallError) || !TRANSIENT.test(e.message)) throw e;
        console.warn(JSON.stringify({ event: 'provider-retry', tool: name, attempt: attempt + 1, error: e.message.slice(0, 120) }));
        // Jitter: a burst of retries in step is another burst. "Busy" asks for a longer pause.
        const base = isBusyError(e) ? 700 : 300;
        await sleep(base * (attempt + 1) + Math.floor(Math.random() * base));
      }
    }
  }

  async #callOnce<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: ++this.#id,
      method: 'tools/call',
      params: { name, arguments: args },
    });

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.#timeoutMs);
    let text: string;
    try {
      const res = await fetch(this.#url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body,
        signal: ac.signal,
      });
      if (!res.ok) throw new McpCallError(`${name}: HTTP ${res.status}`);
      text = await res.text();
    } finally {
      clearTimeout(timer);
    }

    const frame = text
      .split('\n')
      .find((l) => l.startsWith('data: '))
      ?.slice(6);
    const payload = JSON.parse(frame ?? text) as {
      result?: { structuredContent?: unknown; content?: { type: string; text: string }[] };
      error?: McpError;
    };

    if (payload.error) throw new McpCallError(`${name}: ${payload.error.message}`, payload.error);

    const result = payload.result;
    if (result?.structuredContent !== undefined) return result.structuredContent as T;

    const first = result?.content?.find((c) => c.type === 'text')?.text;
    if (first === undefined) throw new McpCallError(`${name}: empty result`, payload);
    try {
      return JSON.parse(first) as T;
    } catch {
      // SuperMCP returns a bare string for validation failures.
      throw new McpCallError(`${name}: ${first.slice(0, 300)}`, first);
    }
  }
}
