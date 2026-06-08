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
  production: false,
  apiBaseUrl: 'http://127.0.0.1:5269',
  signalrHubUrl: 'http://127.0.0.1:5269/cryptomentionhub',
  authProvider: 'local-dev',
  firebase: {
    webApiKey: ''
  },
  useMockData: false,
  enableRealtime: true
};
