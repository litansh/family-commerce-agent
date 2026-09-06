import Constants from 'expo-constants';

/**
 * Public client config. None of this is secret — a shipped mobile app ships
 * these values in its bundle regardless — so they are hardcoded as reliable
 * defaults and can still be overridden per build via app.json `extra`. This
 * also sidesteps Expo Go manifest-nesting differences that left `extra` empty
 * on the device.
 */
const DEFAULTS = {
  apiUrl: 'https://buc8pe49g0.execute-api.eu-central-1.amazonaws.com',
  userPoolId: 'eu-central-1_8yomKtNCE',
  userPoolClientId: '1t7e0himh3heckpassvg0q0e0o',
  cognitoDomain: 'https://fca-4b19ec.auth.eu-central-1.amazoncognito.com',
  region: 'eu-central-1',
  googleEnabled: false,
};

// Expo Go nests the app's extra differently across versions; try each.
const c = Constants as unknown as { expoConfig?: { extra?: Record<string, unknown> }; manifest2?: { extra?: { expoClient?: { extra?: Record<string, unknown> } } }; manifest?: { extra?: Record<string, unknown> } };
const extra = { ...DEFAULTS, ...(c.manifest?.extra ?? {}), ...(c.manifest2?.extra?.expoClient?.extra ?? {}), ...(c.expoConfig?.extra ?? {}) } as Record<string, unknown>;
const str = (k: keyof typeof DEFAULTS): string => (typeof extra[k] === 'string' && extra[k] ? String(extra[k]) : DEFAULTS[k] as string);

export const config = {
  apiUrl: str('apiUrl'),
  userPoolId: str('userPoolId'),
  clientId: str('userPoolClientId'),
  cognitoDomain: str('cognitoDomain'),
  region: str('region'),
  googleEnabled: String(extra['googleEnabled']) === 'true',
};
