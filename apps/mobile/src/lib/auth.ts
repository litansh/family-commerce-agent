/**
 * Sign-in against Cognito's hosted UI (which fronts Google), via the OAuth
 * authorization-code flow with PKCE. A phone is a public client and keeps no
 * secret; the code is exchanged straight from the device.
 *
 * Tokens live in SecureStore (Keychain / Keystore), never AsyncStorage.
 */
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { config } from './config';

WebBrowser.maybeCompleteAuthSession();

const KEY = 'fca.tokens';

export interface Tokens {
  idToken: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

const discovery = {
  authorizationEndpoint: `${config.cognitoDomain}/oauth2/authorize`,
  tokenEndpoint: `${config.cognitoDomain}/oauth2/token`,
  revocationEndpoint: `${config.cognitoDomain}/oauth2/revoke`,
};

export const redirectUri = AuthSession.makeRedirectUri({ scheme: 'kaniti', path: 'auth' });

export async function saveTokens(t: Tokens): Promise<void> { await store(t); }

async function store(t: Tokens | null): Promise<void> {
  if (Platform.OS === 'web') {
    if (t) localStorage.setItem(KEY, JSON.stringify(t));
    else localStorage.removeItem(KEY);
    return;
  }
  if (t) await SecureStore.setItemAsync(KEY, JSON.stringify(t));
  else await SecureStore.deleteItemAsync(KEY);
}

export async function loadTokens(): Promise<Tokens | null> {
  const raw = Platform.OS === 'web' ? localStorage.getItem(KEY) : await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  const t = JSON.parse(raw) as Tokens;
  if (t.expiresAt > Date.now() + 60_000) return t;
  return t.refreshToken ? refresh(t.refreshToken) : null;
}

export async function signIn(provider?: 'Google', mode: 'login' | 'signup' = 'login'): Promise<Tokens | null> {
  const request = new AuthSession.AuthRequest({
    clientId: config.clientId,
    redirectUri,
    scopes: ['openid', 'email', 'profile'],
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    ...(provider ? { extraParams: { identity_provider: provider } } : {}),
  });
  // Cognito serves /signup with the same parameters as /oauth2/authorize and
  // returns the code the same way, so sign-up is the same flow on another page.
  const result = await request.promptAsync(mode === 'signup' ? { ...discovery, authorizationEndpoint: `${config.cognitoDomain}/signup` } : discovery);
  if (result.type !== 'success' || !result.params['code']) return null;

  const res = await AuthSession.exchangeCodeAsync(
    {
      clientId: config.clientId,
      code: result.params['code'],
      redirectUri,
      extraParams: { code_verifier: request.codeVerifier ?? '' },
    },
    discovery,
  );
  const t: Tokens = {
    idToken: res.idToken ?? '',
    accessToken: res.accessToken,
    ...(res.refreshToken ? { refreshToken: res.refreshToken } : {}),
    expiresAt: Date.now() + (res.expiresIn ?? 3600) * 1000,
  };
  await store(t);
  return t;
}

async function refresh(refreshToken: string): Promise<Tokens | null> {
  try {
    const res = await AuthSession.refreshAsync({ clientId: config.clientId, refreshToken }, discovery);
    const t: Tokens = {
      idToken: res.idToken ?? '',
      accessToken: res.accessToken,
      refreshToken,
      expiresAt: Date.now() + (res.expiresIn ?? 3600) * 1000,
    };
    await store(t);
    return t;
  } catch {
    await store(null);
    return null;
  }
}

export async function signOut(): Promise<void> {
  await store(null);
}
