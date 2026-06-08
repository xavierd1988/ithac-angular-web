export type AuthProvider = 'local-dev' | 'firebase-password';

interface AppEnvironment {
  production: boolean;
  apiBaseUrl: string;
  signalrHubUrl: string;
  authProvider: AuthProvider;
  firebase: {
    webApiKey: string;
  };
  useMockData: boolean;
  enableRealtime: boolean;
}

export const appEnvironment: AppEnvironment = {
  production: true,
  apiBaseUrl: 'https://cointrends-api.dukanify.com',
  signalrHubUrl: 'https://cointrends-api.dukanify.com/cryptomentionhub',
  authProvider: 'local-dev',
  firebase: {
    webApiKey: ''
  },
  useMockData: false,
  enableRealtime: false
};
