/**
 * Alerts → Telegram. Subscribed to the alerts SNS topic (CloudWatch alarms on
 * store errors seen by phones). One message per alarm state change, so a
 * store breaking for real families reaches the owner's phone within the hour.
 * Needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID; without them it only logs.
 */
interface SnsEvent { Records?: { Sns?: { Subject?: string; Message?: string } }[] }

export async function handler(event: SnsEvent): Promise<void> {
  const token = process.env['TELEGRAM_BOT_TOKEN'] ?? '';
  const chat = process.env['TELEGRAM_CHAT_ID'] ?? '';
  for (const r of event.Records ?? []) {
    const subject = r.Sns?.Subject ?? 'Kaniti alert';
    let detail = r.Sns?.Message ?? '';
    try {
      const m = JSON.parse(detail) as { AlarmName?: string; NewStateValue?: string; NewStateReason?: string; AlarmDescription?: string };
      if (m.AlarmName) detail = `${m.AlarmName} → ${m.NewStateValue}\n${m.AlarmDescription ?? ''}\n${m.NewStateReason ?? ''}`;
    } catch { /* plain text message */ }
    const text = `🛒 ${subject}\n${detail}`.slice(0, 3900);
    console.log(JSON.stringify({ event: 'alert', subject, detail: detail.slice(0, 500) }));
    if (!token || !chat) continue;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text }) }).catch((e: unknown) => console.warn('telegram failed', e));
  }
}
