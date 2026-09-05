import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;

export const config = {
  apiUrl: extra['apiUrl'] ?? '',
  userPoolId: extra['userPoolId'] ?? '',
  clientId: extra['userPoolClientId'] ?? '',
  cognitoDomain: extra['cognitoDomain'] ?? '',
  region: extra['region'] ?? 'eu-central-1',
};
