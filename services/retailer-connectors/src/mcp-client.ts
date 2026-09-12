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
const TRANSIENT = /internal_error|internal server error/i;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

  async callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.#callOnce<T>(name, args);
      } catch (e) {
        if (attempt >= this.#retries || !(e instanceof McpCallError) || !TRANSIENT.test(e.message)) throw e;
        await sleep(300 * (attempt + 1));
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
