/**
 * What the cloud must be able to do at a store, on the family's behalf, with
 * no browser and no home machine (ADR 0008).
 *
 * A driver is one store's ladder rungs: a one-time code (`startOtp` +
 * `verifyOtp`), a password used once (`passwordLogin`), and what every rung
 * ends in — a session the store issued, checked with the store's own
 * `signedIn`. Drivers omit the rungs a store does not offer; the API turns a
 * missing rung into the next one on the ladder.
 *
 * Nothing a person types during connect is kept: a driver receives a phone
 * number, an e-mail or a password as call arguments and returns only the
 * session. Challenges carry what the store needs to finish its own exchange
 * (an OTP transaction id, a pre-login cookie) and expire in minutes.
 */
import type { CapturedSession } from './cookie-jar.ts';
import type { PastOrderRaw } from './shufersal-cloud.ts';

export type { PastOrderRaw };

/** A store session the cloud can act with: cookies and, where the store uses them, bearer tokens. */
export interface StoreSession extends CapturedSession {
  /** Bearer / refresh tokens for stores whose API is token-based (Wolt). */
  readonly tokens?: Readonly<Record<string, string>>;
}

/** The half-finished one-time-code exchange, between "code sent" and "code typed". */
export interface OtpChallenge {
  readonly store: string;
  /** Where the store sent the code, masked for display (`05•••••12`, `l•••@example.com`). */
  readonly sentTo: string;
  /** Opaque driver state needed to finish: transaction ids, pre-login cookies. Never a password. */
  readonly state: Readonly<Record<string, string>>;
}

export type ConnectFailReason = 'wrong_code' | 'wrong_password' | 'no_account' | 'blocked' | 'unavailable' | 'expired';
export class ConnectFailed extends Error {
  readonly store: string;
  readonly reason: ConnectFailReason;
  constructor(store: string, reason: ConnectFailReason, detail?: string) {
    super(`${store}: ${reason}${detail ? ` — ${detail}` : ''}`);
    this.name = 'ConnectFailed';
    this.store = store;
    this.reason = reason;
  }
}

export interface StoreDriver {
  readonly id: string;
  /** Which identifier the store's one-time code wants. Absent: no OTP rung. */
  readonly otp?: 'phone' | 'email';
  /** True when the store has a password sign-in the cloud can drive. */
  readonly password?: boolean;
  /** Ask the store to send its one-time code to `target` (a phone or an e-mail). */
  startOtp?(target: string): Promise<OtpChallenge>;
  /** Finish the exchange with the code the person typed. */
  verifyOtp?(challenge: OtpChallenge, code: string): Promise<StoreSession>;
  /** Sign in once with e-mail + password; the password is used and forgotten. */
  passwordLogin?(email: string, password: string): Promise<StoreSession>;
  /** The store's own answer to "is this session signed in?" */
  signedIn(session: StoreSession): Promise<boolean>;
  /** Past orders through the session, newest first. */
  orderHistory?(session: StoreSession, limit?: number): Promise<PastOrderRaw[]>;
}

/** `0501234567` → `05•••••67`; `lab@example.com` → `l••@example.com`. */
export function mask(target: string): string {
  const at = target.indexOf('@');
  if (at > 0) return `${target[0]}••@${target.slice(at + 1)}`;
  const d = target.replace(/\D/g, '');
  return d.length > 4 ? `${d.slice(0, 2)}${'•'.repeat(d.length - 4)}${d.slice(-2)}` : '••••';
}

/** Israeli mobile numbers as the stores expect them: `05XXXXXXXX`. */
export function localPhone(input: string): string | null {
  let d = input.replace(/\D/g, '');
  if (d.startsWith('972')) d = `0${d.slice(3)}`;
  return /^05\d{8}$/.test(d) ? d : null;
}

/** Set-Cookie headers → cookies, keeping the last value per name. */
export function cookiesFrom(res: Response, domain: string): { name: string; value: string; domain: string }[] {
  const raw = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  const out = new Map<string, { name: string; value: string; domain: string }>();
  for (const line of raw) {
    const [pair] = line.split(';');
    const eq = pair!.indexOf('=');
    if (eq <= 0) continue;
    out.set(pair!.slice(0, eq).trim(), { name: pair!.slice(0, eq).trim(), value: pair!.slice(eq + 1).trim(), domain });
  }
  return [...out.values()];
}

/** Merge new cookies over old ones, by name. */
export function mergeCookies(base: readonly CapturedSession['cookies'][number][], next: readonly CapturedSession['cookies'][number][]): CapturedSession['cookies'][number][] {
  const m = new Map(base.map((c) => [c.name, c]));
  for (const c of next) m.set(c.name, c);
  return [...m.values()];
}
