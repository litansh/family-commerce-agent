import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McpClient, McpCallError } from '../src/mcp-client.ts';

const sseBody = (result: unknown) => `data: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { structuredContent: result } })}\n`;
const errorBody = (message: string) => `data: ${JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32603, message } })}\n`;

test('a transient internal_error is retried with backoff and can still succeed', async () => {
  const orig = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (calls === 1) return new Response(errorBody('Error: Internal server error (code: internal_error)'), { status: 200 });
    return new Response(sseBody({ ok: true }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await new McpClient('https://example.test/mcp', 5_000, 1).callTool('search_products', {});
    assert.deepEqual(result, { ok: true });
    assert.equal(calls, 2);
  } finally { globalThis.fetch = orig; }
});

test('retries are bounded — past the limit the transient error still surfaces', async () => {
  const orig = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response(errorBody('Error: Internal server error (code: internal_error)'), { status: 200 }); }) as typeof fetch;
  try {
    await assert.rejects(
      () => new McpClient('https://example.test/mcp', 5_000, 1).callTool('search_products', {}),
      McpCallError,
    );
    assert.equal(calls, 2); // one try plus one retry, never more
  } finally { globalThis.fetch = orig; }
});

test('a non-transient error (a validation failure) is never retried', async () => {
  const orig = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response(errorBody('invalid argument: query is required'), { status: 200 }); }) as typeof fetch;
  try {
    await assert.rejects(() => new McpClient('https://example.test/mcp', 5_000, 2).callTool('search_products', {}), McpCallError);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = orig; }
});

test('with no retries configured (the default), a transient error surfaces on the first try', async () => {
  const orig = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response(errorBody('Error: Internal server error (code: internal_error)'), { status: 200 }); }) as typeof fetch;
  try {
    await assert.rejects(() => new McpClient('https://example.test/mcp', 5_000).callTool('optimize_delivery', {}), McpCallError);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = orig; }
});
