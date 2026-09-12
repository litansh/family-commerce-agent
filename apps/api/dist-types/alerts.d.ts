/**
 * Alerts → Telegram. Subscribed to the alerts SNS topic (CloudWatch alarms on
 * store errors seen by phones). One message per alarm state change, so a
 * store breaking for real families reaches the owner's phone within the hour.
 * Needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID; without them it only logs.
 */
interface SnsEvent {
    Records?: {
        Sns?: {
            Subject?: string;
            Message?: string;
        };
    }[];
}
export declare function handler(event: SnsEvent): Promise<void>;
export {};
