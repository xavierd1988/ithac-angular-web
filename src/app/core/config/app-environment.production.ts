export type AuthProvider = 'local-dev' | 'firebase-password';

interface AppEnvironment {
  production: boolean;
  apiBaseUrl: string;
  rawDbApiBaseUrl: string;
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
  rawDbApiBaseUrl: 'https://api.ithacapp.com',
  signalrHubUrl: 'https://cointrends-api.dukanify.com/cryptomentionhub',
  authProvider: 'local-dev',
  firebase: {
    webApiKey: ''
  },
  useMockData: false,
  enableRealtime: false
};
