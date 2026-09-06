/**
 * A captured browser session, reduced to what a server needs to act as that
 * browser: the cookies. The phone captures them after login (where httpOnly
 * cookies are readable via the native cookie manager) and posts them here.
 *
 * We never store a password — only the session the retailer already issued,
 * which the retailer can revoke at any time. That is a deliberately weaker,
 * safer thing to hold than credentials.
 */
export interface Cookie {
  readonly name: string;
  readonly value: string;
  readonly domain?: string;
  readonly path?: string;
}

export interface CapturedSession {
  readonly retailer: string;
  readonly cookies: readonly Cookie[];
  readonly capturedAt: string;
  /** Where the phone captured it, for the audit log. Never a password. */
  readonly userAgent?: string;
}

/** Cookies for one host, as a single `Cookie:` header value. */
export function cookieHeader(session: CapturedSession, host: string): string {
  return session.cookies
    .filter((c) => !c.domain || host.endsWith(c.domain.replace(/^\./, '')))
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

/** A cookie's value, by name — for CSRF tokens the site expects echoed back. */
export function cookieValue(session: CapturedSession, name: string): string | undefined {
  return session.cookies.find((c) => c.name === name)?.value;
}
