import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../src/alerts.ts';

function snsEvent(subject: string, message: string) {
  return { Records: [{ Sns: { Subject: subject, Message: message } }] };
}

test('with no bot token or chat id, an alarm is only logged — never sent', async (t: TestContext) => {
  delete process.env['TELEGRAM_BOT_TOKEN'];
  delete process.env['TELEGRAM_CHAT_ID'];
  const calls: unknown[] = [];
  t.mock.method(globalThis, 'fetch', async (...args: unknown[]) => { calls.push(args); return new Response('{}'); });

  await handler(snsEvent('Kaniti alert', 'plain text, not an alarm'));

  assert.equal(calls.length, 0);
});

test('a real CloudWatch alarm reaches Telegram with the alarm name, state and reason', async (t: TestContext) => {
  process.env['TELEGRAM_BOT_TOKEN'] = 'tok';
  process.env['TELEGRAM_CHAT_ID'] = 'chat';
  t.after(() => { delete process.env['TELEGRAM_BOT_TOKEN']; delete process.env['TELEGRAM_CHAT_ID']; });

  const calls: { url: string; body: unknown }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) as unknown });
    return new Response('{"ok":true}');
  });

  const alarm = JSON.stringify({ AlarmName: 'stores_slow', NewStateValue: 'ALARM', AlarmDescription: 'a store answered slowly', NewStateReason: 'Threshold Crossed' });
  await handler(snsEvent('Kaniti alert', alarm));

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, 'https://api.telegram.org/bottok/sendMessage');
  const body = calls[0]?.body as { chat_id: string; text: string };
  assert.equal(body.chat_id, 'chat');
  assert.match(body.text, /stores_slow → ALARM/);
  assert.match(body.text, /a store answered slowly/);
  assert.match(body.text, /Threshold Crossed/);
});

test('plain-text (non-alarm) SNS messages pass through untouched, and a failed send never throws', async (t: TestContext) => {
  process.env['TELEGRAM_BOT_TOKEN'] = 'tok';
  process.env['TELEGRAM_CHAT_ID'] = 'chat';
  t.after(() => { delete process.env['TELEGRAM_BOT_TOKEN']; delete process.env['TELEGRAM_CHAT_ID']; });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('network down'); });

  await handler(snsEvent('Kaniti alert', 'a hand-written subject, not JSON'));
});

test('a 3900-char cap keeps a very long message from being rejected by Telegram', async (t: TestContext) => {
  process.env['TELEGRAM_BOT_TOKEN'] = 'tok';
  process.env['TELEGRAM_CHAT_ID'] = 'chat';
  t.after(() => { delete process.env['TELEGRAM_BOT_TOKEN']; delete process.env['TELEGRAM_CHAT_ID']; });

  let sentText = '';
  t.mock.method(globalThis, 'fetch', async (_url: string, init: { body: string }) => {
    sentText = (JSON.parse(init.body) as { text: string }).text;
    return new Response('{}');
  });

  await handler(snsEvent('Kaniti alert', 'x'.repeat(5000)));

  assert.ok(sentText.length <= 3900);
});
