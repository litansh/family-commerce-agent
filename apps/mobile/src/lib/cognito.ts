/**
 * Cognito's JSON API, called directly so the app owns the sign-up and
 * sign-in forms — Hebrew, password confirmation, verification code — instead
 * of sending people to a hosted English page. No SDK: four small calls.
 */
import { config } from './config';
import type { Tokens } from './auth';

const endpoint = `https://cognito-idp.${config.region}.amazonaws.com/`;

async function call<T>(op: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': `AWSCognitoIdentityProviderService.${op}` },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { __type?: string; message?: string };
  if (!res.ok) throw new CognitoError(data.__type ?? 'Unknown', data.message ?? 'error');
  return data;
}

export class CognitoError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code.replace(/^.*#/, '');
  }
}

export const signUp = (email: string, password: string) =>
  call<{ UserConfirmed: boolean }>('SignUp', { ClientId: config.clientId, Username: email, Password: password, UserAttributes: [{ Name: 'email', Value: email }] });

export const confirmSignUp = (email: string, code: string) =>
  call<Record<string, never>>('ConfirmSignUp', { ClientId: config.clientId, Username: email, ConfirmationCode: code });

export const resendCode = (email: string) =>
  call<Record<string, never>>('ResendConfirmationCode', { ClientId: config.clientId, Username: email });

export async function passwordSignIn(email: string, password: string): Promise<Tokens> {
  const r = await call<{ AuthenticationResult?: { IdToken: string; AccessToken: string; RefreshToken?: string; ExpiresIn: number }; ChallengeName?: string }>('InitiateAuth', {
    ClientId: config.clientId, AuthFlow: 'USER_PASSWORD_AUTH', AuthParameters: { USERNAME: email, PASSWORD: password },
  });
  const a = r.AuthenticationResult;
  if (!a) throw new CognitoError(r.ChallengeName ?? 'Challenge', 'additional step required');
  return { idToken: a.IdToken, accessToken: a.AccessToken, ...(a.RefreshToken ? { refreshToken: a.RefreshToken } : {}), expiresAt: Date.now() + a.ExpiresIn * 1000 };
}

export const forgotPassword = (email: string) => call<Record<string, never>>('ForgotPassword', { ClientId: config.clientId, Username: email });
export const confirmForgotPassword = (email: string, code: string, password: string) =>
  call<Record<string, never>>('ConfirmForgotPassword', { ClientId: config.clientId, Username: email, ConfirmationCode: code, Password: password });

/** Human words for the codes people actually hit. */
export function explain(e: unknown, t: (k: string) => string): string {
  const code = e instanceof CognitoError ? e.code : '';
  switch (code) {
    case 'UsernameExistsException': return t('errExists');
    case 'InvalidPasswordException': return t('errWeak');
    case 'CodeMismatchException': return t('errCode');
    case 'ExpiredCodeException': return t('errCodeExpired');
    case 'NotAuthorizedException': return t('errWrong');
    case 'UserNotFoundException': return t('errWrong');
    case 'UserNotConfirmedException': return t('errUnconfirmed');
    case 'LimitExceededException': return t('errLimit');
    default: return e instanceof Error ? e.message : String(e);
  }
}
